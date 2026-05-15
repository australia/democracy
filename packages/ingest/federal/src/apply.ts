import {
  chambers,
  electorates,
  getDb,
  jurisdictions,
  reps,
  rosterAudit,
  type NewRep,
} from "@au/db";
import type { RawRep } from "@au/ingest-shared";
import { and, eq, isNull } from "drizzle-orm";

export async function apply(rows: RawRep[]): Promise<void> {
  const db = getDb();

  // 1) Audit raw scrape
  await db.insert(rosterAudit).values({
    jurisdiction: "federal",
    rowsRaw: rows as unknown as object,
  });

  // 2) Resolve federal chambers
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
  const chamberId = (kind: "lower" | "upper") =>
    fedChambers.find((c) => c.kind === kind)?.id;

  // 3) Upsert reps (we treat externalId+chamber as the natural key)
  let inserted = 0;
  let updated = 0;
  for (const r of rows) {
    const cid = chamberId(r.chamberKind === "unicameral" ? "lower" : r.chamberKind);
    if (!cid) continue;

    // Look up electorate id by code+chamber if applicable (will be empty
    // until boundaries are imported; we still store the code on reps).
    let electorateId: string | undefined;
    if (r.electorateCode && r.chamberKind === "lower") {
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
      contactFormKind: r.contactFormKind ?? "aph",
      activeAsOf: new Date(),
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
    } else {
      await db.insert(reps).values(values);
      inserted++;
    }
  }

  console.log(`Federal ingest: inserted=${inserted} updated=${updated} total=${rows.length}`);
}
