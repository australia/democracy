import {
  chambers,
  electorates,
  getDb,
  jurisdictions,
  reps,
} from "@au/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as shapefile from "shapefile";

type FeatureGeom =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

interface AusElbFeature {
  type: "Feature";
  geometry: FeatureGeom;
  properties: Record<string, unknown>;
}

function asMultiPolygon(geom: FeatureGeom): {
  type: "MultiPolygon";
  coordinates: number[][][][];
} {
  if (geom.type === "MultiPolygon") return geom;
  return { type: "MultiPolygon", coordinates: [geom.coordinates] };
}

export async function loadFederalBoundaries(shpPath: string): Promise<void> {
  const db = getDb();
  const [federal] = await db
    .select()
    .from(jurisdictions)
    .where(eq(jurisdictions.code, "federal"))
    .limit(1);
  if (!federal) throw new Error("federal jurisdiction missing — run db:seed first");

  const fedChambers = await db
    .select()
    .from(chambers)
    .where(eq(chambers.jurisdictionId, federal.id));
  const lower = fedChambers.find((c) => c.kind === "lower");
  if (!lower) throw new Error("federal lower chamber missing");

  // Mark any currently-active electorate row as obsolete; the AEC redistribution
  // process means we treat each ingest as defining the current set. Rows that
  // re-appear keep their id (we upsert by code+chamber when valid_to IS NULL).
  console.log(`Reading shapefile: ${shpPath}`);

  const source = await shapefile.open(shpPath);
  let inserted = 0;
  let updated = 0;
  const seenCodes = new Set<string>();

  while (true) {
    const r = (await source.read()) as
      | { done: true; value: undefined }
      | { done: false; value: AusElbFeature };
    if (r.done) break;
    const f = r.value;
    const name = String(f.properties["Elect_div"] ?? "").trim();
    if (!name) continue;

    const mp = asMultiPolygon(f.geometry);
    const geojson = JSON.stringify(mp);

    // Use the electorate name as both code and name (AEC uses the name as the
    // human-readable key; the numeric E_div_numb changes across redistributions).
    seenCodes.add(name);

    const existing = await db
      .select()
      .from(electorates)
      .where(
        and(
          eq(electorates.chamberId, lower.id),
          eq(electorates.code, name),
          isNull(electorates.validTo),
        ),
      )
      .limit(1);

    const geomSql = sql`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326))::geography`;

    if (existing[0]) {
      await db
        .update(electorates)
        .set({
          name,
          geom: geomSql as unknown as string,
          sourceRev: "AEC 2025-03",
        })
        .where(eq(electorates.id, existing[0].id));
      updated++;
    } else {
      await db.insert(electorates).values({
        chamberId: lower.id,
        code: name,
        name,
        geom: geomSql as unknown as string,
        sourceRev: "AEC 2025-03",
      });
      inserted++;
    }
  }

  console.log(
    `Boundaries: inserted=${inserted} updated=${updated} total=${seenCodes.size}`,
  );

  // Backfill rep -> electorate links. We stored the AEC electorate name as
  // reps.electorate_id earlier — wait, no, we stored it as nothing (the
  // electorate_id lookup at apply-time returned null because no electorates
  // existed yet). The reliable backfill: match reps that have a chamberId
  // matching lower and look up their stored externalId-derived electorate.
  // Actually, the cleanest approach: re-derive from the most recent
  // roster_audit row. For now, do a direct join via the cached
  // electorate name (we kept it as `electorate_id` resolution input — but
  // didn't persist the name on reps). Easiest robust path: link by name now
  // using a fresh query that pulls the latest roster audit and matches on
  // name within the federal lower chamber.

  await db.execute(sql`
    WITH latest AS (
      SELECT rows_raw FROM roster_audit
      WHERE jurisdiction = 'federal'
      ORDER BY scraped_at DESC
      LIMIT 1
    ), members AS (
      SELECT (row->>'externalId') AS ext_id,
             (row->>'electorateCode') AS code
      FROM latest, jsonb_array_elements(latest.rows_raw) AS row
    )
    UPDATE reps r
    SET electorate_id = e.id
    FROM members m
    JOIN electorates e
      ON LOWER(e.code) = LOWER(m.code)
     AND e.chamber_id = ${lower.id}
     AND e.valid_to IS NULL
    WHERE r.external_id = m.ext_id
      AND r.chamber_id = ${lower.id}
  `);

  const rowsLinked = (await db.execute(sql`
    SELECT COUNT(*)::int AS linked
    FROM reps WHERE chamber_id = ${lower.id} AND electorate_id IS NOT NULL
  `)) as unknown as Array<{ linked: number }>;
  const linked = rowsLinked[0]?.linked ?? 0;
  console.log(`Linked reps -> electorates (federal lower): ${linked} rows`);

  // Sanity check: how many lower-house reps still lack an electorate?
  const orphans = await db
    .select({ id: reps.id, name: reps.fullName, code: reps.externalId })
    .from(reps)
    .where(and(eq(reps.chamberId, lower.id), isNull(reps.electorateId)));
  if (orphans.length > 0) {
    console.log(
      `Warning: ${orphans.length} lower-house reps still unlinked (likely a name mismatch):`,
    );
    for (const o of orphans.slice(0, 10)) console.log("  ", o.name, o.code);
  }
}
