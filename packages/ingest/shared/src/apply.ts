import { and, eq, isNull } from "drizzle-orm";
import {
  chambers,
  electorates,
  getDb,
  jurisdictions,
  reps,
  rosterAudit,
  type NewRep,
} from "@au/db";
import type { RawRep } from "./types";

type JurisdictionCode =
  | "federal"
  | "nsw"
  | "vic"
  | "qld"
  | "wa"
  | "sa"
  | "tas"
  | "act"
  | "nt";

export interface ApplyOptions {
  jurisdictionCode: JurisdictionCode;
  /** Defaults to true. When true we mark reps that didn't appear in this scrape
   * as `inactive_as_of=now` (so they're removed from active lookups). */
  retireMissing?: boolean;
}

export async function applyRoster(
  rows: RawRep[],
  opts: ApplyOptions,
): Promise<{ inserted: number; updated: number; retired: number }> {
  const db = getDb();

  await db.insert(rosterAudit).values({
    jurisdiction: opts.jurisdictionCode,
    rowsRaw: rows as unknown as object,
  });

  const [j] = await db
    .select()
    .from(jurisdictions)
    .where(eq(jurisdictions.code, opts.jurisdictionCode))
    .limit(1);
  if (!j) {
    throw new Error(
      `jurisdiction ${opts.jurisdictionCode} missing — run db:seed first`,
    );
  }

  const jChambers = await db
    .select()
    .from(chambers)
    .where(eq(chambers.jurisdictionId, j.id));
  const chamberIdFor = (kind: "lower" | "upper" | "unicameral") =>
    jChambers.find((c) => c.kind === kind)?.id;

  let inserted = 0;
  let updated = 0;
  const seenIds: string[] = [];

  for (const r of rows) {
    const cid = chamberIdFor(r.chamberKind);
    if (!cid) continue;

    // Resolve electorate if present.
    let electorateId: string | undefined;
    if (r.electorateCode) {
      const matches = await db
        .select()
        .from(electorates)
        .where(
          and(
            eq(electorates.chamberId, cid),
            eq(electorates.code, r.electorateCode),
            isNull(electorates.validTo),
          ),
        );
      electorateId = matches[0]?.id;
    }

    const values: NewRep = {
      chamberId: cid,
      electorateId,
      stateCode: r.stateCode,
      externalId: r.externalId,
      fullName: r.fullName,
      given: r.given,
      family: r.family,
      honorific: r.honorific,
      party: r.party,
      photoUrl: r.photoUrl,
      profileUrl: r.profileUrl,
      primaryEmail: r.primaryEmail,
      altEmails: r.altEmails ?? [],
      contactFormUrl: r.contactFormUrl,
      contactFormKind: r.contactFormKind ?? "none",
      activeAsOf: new Date(),
      inactiveAsOf: null,
      lastVerified: new Date(),
    };

    const [existing] = await db
      .select()
      .from(reps)
      .where(and(eq(reps.chamberId, cid), eq(reps.externalId, r.externalId)))
      .limit(1);
    if (existing) {
      await db
        .update(reps)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(reps.id, existing.id));
      updated++;
      seenIds.push(existing.id);
    } else {
      const ins = await db.insert(reps).values(values).returning({ id: reps.id });
      inserted++;
      if (ins[0]) seenIds.push(ins[0].id);
    }
  }

  // Retire reps in this jurisdiction's chambers that didn't appear in the
  // scrape. We never delete history; just flip inactive_as_of.
  let retired = 0;
  if (opts.retireMissing !== false && jChambers.length > 0 && seenIds.length > 0) {
    // Drizzle does support array operations but mixing with the
    // workspace patterns is fiddly; do it via raw SQL.
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`
      UPDATE reps
      SET inactive_as_of = NOW()
      WHERE chamber_id IN (${sql.join(jChambers.map((c) => sql`${c.id}`), sql`, `)})
        AND inactive_as_of IS NULL
        AND id NOT IN (${sql.join(seenIds.map((i) => sql`${i}`), sql`, `)})
    `);
    retired = (result as unknown as { count?: number }).count ?? 0;
  }

  console.log(
    `[${opts.jurisdictionCode}] roster apply: inserted=${inserted} updated=${updated} retired=${retired}`,
  );
  return { inserted, updated, retired };
}
