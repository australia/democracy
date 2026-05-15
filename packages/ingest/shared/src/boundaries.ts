// Generic shapefile -> PostGIS loader for electorate boundaries. Each
// jurisdiction's loader provides the shapefile path, jurisdiction code, the
// chamber kind ("lower" or "upper" — unicameral chambers also use "lower" in
// our schema's terms) and the DBF attribute that carries the electorate name.
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  chambers,
  electorates,
  getDb,
  jurisdictions,
  reps,
} from "@au/db";
import * as shapefile from "shapefile";

export interface LoadBoundariesOpts {
  shpPath: string;
  jurisdictionCode:
    | "federal"
    | "nsw"
    | "vic"
    | "qld"
    | "wa"
    | "sa"
    | "tas"
    | "act"
    | "nt";
  /** "lower" for House/Assembly seats; "upper" for Council regions; "unicameral"
   * for territory/Qld assemblies. */
  chamberKind: "lower" | "upper" | "unicameral";
  /** DBF attribute name carrying the electorate's display name. */
  nameField: string;
  /** Optional override: derive the code (lookup key) from the name. Defaults
   * to identity. Useful where the published name needs normalising (e.g.
   * lowercasing or trimming punctuation) to match the rep's electorateCode. */
  codeFromName?: (name: string) => string;
  /** Tag stored on electorates.source_rev for audit. */
  sourceRev: string;
  /** Optional filter — keep only features for which this returns true.
   * Used for bulk shapefiles like the ABS SED (covers all states; filter
   * by STE_CODE21). */
  filter?: (props: Record<string, unknown>) => boolean;
}

type FeatureGeom =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

function asMultiPolygon(geom: FeatureGeom): {
  type: "MultiPolygon";
  coordinates: number[][][][];
} {
  if (geom.type === "MultiPolygon") return geom;
  return { type: "MultiPolygon", coordinates: [geom.coordinates] };
}

export async function loadBoundaries(
  opts: LoadBoundariesOpts,
): Promise<{ inserted: number; updated: number; linkedReps: number }> {
  const db = getDb();
  const [j] = await db
    .select()
    .from(jurisdictions)
    .where(eq(jurisdictions.code, opts.jurisdictionCode))
    .limit(1);
  if (!j)
    throw new Error(
      `jurisdiction ${opts.jurisdictionCode} missing — run db:seed first`,
    );

  const jChambers = await db
    .select()
    .from(chambers)
    .where(eq(chambers.jurisdictionId, j.id));
  const chamber = jChambers.find((c) => c.kind === opts.chamberKind);
  if (!chamber)
    throw new Error(
      `chamber ${opts.chamberKind} not seeded for jurisdiction ${opts.jurisdictionCode}`,
    );

  console.log(`Reading ${opts.jurisdictionCode} ${opts.chamberKind}: ${opts.shpPath}`);

  const source = await shapefile.open(opts.shpPath);
  let inserted = 0;
  let updated = 0;
  let processed = 0;

  while (true) {
    const r = (await source.read()) as
      | { done: true; value: undefined }
      | { done: false; value: { geometry: FeatureGeom; properties: Record<string, unknown> } };
    if (r.done) break;
    const f = r.value;
    if (opts.filter && !opts.filter(f.properties)) continue;
    if (!f.geometry || !("type" in f.geometry)) continue; // null-geom rows
    const sourceName = String(f.properties[opts.nameField] ?? "").trim();
    if (!sourceName) continue;
    // Both the code (lookup key) and the displayed name use codeFromName, so
    // shapefiles with verbose names like "Melbourne (Northern Metropolitan)"
    // surface as the bare "Melbourne".
    const code = (opts.codeFromName ?? ((n) => n))(sourceName);
    const rawName = code;

    const mp = asMultiPolygon(f.geometry);
    const geojson = JSON.stringify(mp);
    const geomSql = sql`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326))::geography`;

    const existing = await db
      .select()
      .from(electorates)
      .where(
        and(
          eq(electorates.chamberId, chamber.id),
          eq(electorates.code, code),
          isNull(electorates.validTo),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(electorates)
        .set({
          name: rawName,
          geom: geomSql as unknown as string,
          sourceRev: opts.sourceRev,
        })
        .where(eq(electorates.id, existing[0].id));
      updated++;
    } else {
      await db.insert(electorates).values({
        chamberId: chamber.id,
        code,
        name: rawName,
        geom: geomSql as unknown as string,
        sourceRev: opts.sourceRev,
      });
      inserted++;
    }
    processed++;
  }

  console.log(
    `  inserted=${inserted} updated=${updated} total=${processed}`,
  );

  // Link reps in this chamber whose electorateCode matches the new rows.
  // Case-insensitive to absorb sites that title-case differently from the
  // shapefile's stored casing.
  await db.execute(sql`
    UPDATE reps r
    SET electorate_id = e.id
    FROM electorates e
    WHERE e.chamber_id = ${chamber.id}
      AND e.valid_to IS NULL
      AND r.chamber_id = ${chamber.id}
      AND r.inactive_as_of IS NULL
      AND r.electorate_id IS NULL
      AND LOWER(r.external_id) = LOWER(e.code)
  `);

  // Many state ingests don't carry a code on the rep — fall back to matching
  // by the rep's *stored* electorate code (which I write into `external_id`
  // in some scrapers and as a separate field in others). For state ingests
  // built since the v1 roster cleanup, electorateCode is the name; reps's
  // external_id is the parliamentary site's ID. So a more reliable join is
  // via the latest roster_audit row.
  await db.execute(sql`
    WITH latest AS (
      SELECT rows_raw FROM roster_audit
      WHERE jurisdiction = ${opts.jurisdictionCode}
      ORDER BY scraped_at DESC
      LIMIT 1
    ), members AS (
      SELECT (row->>'externalId') AS ext_id,
             (row->>'electorateCode') AS code,
             (row->>'chamberKind') AS kind
      FROM latest, jsonb_array_elements(latest.rows_raw) AS row
    )
    UPDATE reps r
    SET electorate_id = e.id
    FROM members m
    JOIN electorates e
      ON LOWER(e.code) = LOWER(m.code)
     AND e.chamber_id = ${chamber.id}
     AND e.valid_to IS NULL
    WHERE r.external_id = m.ext_id
      AND r.chamber_id = ${chamber.id}
      AND m.kind = ${opts.chamberKind}
  `);

  // Prefix-match fallback. State scrapers sometimes return "Cessnock Temporary"
  // or "Sydney The Nationals member" — the electorate name plus trailing role
  // text. Match the longest electorate name that prefixes the captured code.
  await db.execute(sql`
    WITH latest AS (
      SELECT rows_raw FROM roster_audit
      WHERE jurisdiction = ${opts.jurisdictionCode}
      ORDER BY scraped_at DESC
      LIMIT 1
    ), members AS (
      SELECT (row->>'externalId') AS ext_id,
             (row->>'electorateCode') AS code,
             (row->>'chamberKind') AS kind
      FROM latest, jsonb_array_elements(latest.rows_raw) AS row
    ), candidates AS (
      SELECT m.ext_id, e.id AS electorate_id,
             ROW_NUMBER() OVER (PARTITION BY m.ext_id ORDER BY LENGTH(e.name) DESC) AS rn
      FROM members m
      JOIN electorates e
        ON e.chamber_id = ${chamber.id}
       AND e.valid_to IS NULL
       AND LOWER(m.code) LIKE LOWER(e.name) || ' %'
      WHERE m.kind = ${opts.chamberKind}
    )
    UPDATE reps r
    SET electorate_id = c.electorate_id
    FROM candidates c
    WHERE r.external_id = c.ext_id
      AND r.chamber_id = ${chamber.id}
      AND r.electorate_id IS NULL
      AND c.rn = 1
  `);

  const linked = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM reps WHERE chamber_id = ${chamber.id} AND electorate_id IS NOT NULL
      AND inactive_as_of IS NULL
  `)) as unknown as Array<{ n: number }>;
  const n = linked[0]?.n ?? 0;
  console.log(
    `  reps linked to electorates: ${n}`,
  );

  return { inserted, updated, linkedReps: n };
}
