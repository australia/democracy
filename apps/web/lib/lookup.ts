import { getDb } from "@au/db";
import { sql } from "drizzle-orm";

export interface RepLookup {
  id: string;
  fullName: string;
  honorific: string | null;
  party: string | null;
  chamberKind: "lower" | "upper" | "unicameral";
  jurisdictionCode: string;
  electorateName: string | null;
  stateCode: string | null;
  primaryEmail: string | null;
  contactFormUrl: string | null;
  photoUrl: string | null;
}

export interface LookupResult {
  electorates: Array<{
    chamberKind: "lower" | "upper" | "unicameral";
    jurisdictionCode: string;
    name: string;
  }>;
  stateCode: string | null;
  reps: RepLookup[];
}

// Run a single SQL pass that:
//   1) Finds the lower-house electorate the point falls in (per jurisdiction)
//   2) Determines the state from that electorate
//   3) Returns every rep representing this address: the lower-house MP plus
//      all upper-house members whose state matches.
export async function lookupRepsByPoint(
  lng: number,
  lat: number,
): Promise<LookupResult> {
  const db = getDb();

  const point = sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;

  // Hard-coded list of state upper houses that are *state-wide* (i.e. every
  // voter has all members as their reps). Regional upper houses (VIC LC, TAS
  // LC) are excluded; those require region boundaries to look up correctly.
  // Federal Senate is state-based but handled separately below.
  // - NSW LC: 42 members elected at-large
  // - WA LC: 37 members elected at-large (post 2021 reform, in force 2025)
  // - SA LC: 22 members elected at-large
  // - ACT, NT unicamerals are regional; QLD unicameral too.
  const STATE_WIDE_UPPER_JURIS = ["nsw", "wa", "sa"];

  const rows = (await db.execute(sql`
    WITH hit AS (
      SELECT e.id AS electorate_id, e.name AS electorate_name,
             c.kind AS chamber_kind, c.id AS chamber_id,
             j.code AS jurisdiction_code, j.id AS jurisdiction_id
      FROM electorates e
      JOIN chambers c ON c.id = e.chamber_id
      JOIN jurisdictions j ON j.id = c.jurisdiction_id
      WHERE e.valid_to IS NULL
        AND ST_Contains(e.geom::geometry, ${point})
    ),
    inferred_state AS (
      SELECT r2.state_code AS code FROM reps r2
      WHERE r2.electorate_id IN (SELECT electorate_id FROM hit WHERE chamber_kind = 'lower')
        AND r2.inactive_as_of IS NULL
      LIMIT 1
    )
    SELECT r.id, r.full_name AS "fullName", r.honorific, r.party,
           c.kind AS "chamberKind", j.code AS "jurisdictionCode",
           e.name AS "electorateName", r.state_code AS "stateCode",
           r.primary_email AS "primaryEmail", r.contact_form_url AS "contactFormUrl",
           r.photo_url AS "photoUrl"
    FROM reps r
    JOIN chambers c ON c.id = r.chamber_id
    JOIN jurisdictions j ON j.id = c.jurisdiction_id
    LEFT JOIN electorates e ON e.id = r.electorate_id
    WHERE r.inactive_as_of IS NULL
      AND (
        -- Lower-house MP for the federal electorate the point falls in
        r.electorate_id IN (SELECT electorate_id FROM hit WHERE chamber_kind = 'lower')
        OR
        -- Federal Senate: 12 senators for the user's state (2 for territories)
        (
          c.kind = 'upper'
          AND j.code = 'federal'
          AND r.state_code = (SELECT code FROM inferred_state)
        )
        OR
        -- State-wide upper houses (NSW LC, WA LC, SA LC).
        (
          c.kind = 'upper'
          AND j.code::text = ANY(ARRAY[${sql.join(STATE_WIDE_UPPER_JURIS.map((s) => sql`${s}`), sql`, `)}]::text[])
          AND r.state_code = (SELECT code FROM inferred_state)
        )
      )
    ORDER BY
      CASE c.kind WHEN 'lower' THEN 1 WHEN 'unicameral' THEN 2 ELSE 3 END,
      j.code,
      r.family ASC NULLS LAST
  `)) as unknown as RepLookup[];

  const electorates: LookupResult["electorates"] = [];
  let stateCode: string | null = null;
  for (const r of rows) {
    if (r.chamberKind === "lower" && r.electorateName) {
      electorates.push({
        chamberKind: "lower",
        jurisdictionCode: r.jurisdictionCode,
        name: r.electorateName,
      });
      stateCode = r.stateCode ?? stateCode;
    }
  }

  return { electorates, stateCode, reps: rows };
}
