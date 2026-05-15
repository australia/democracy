import { eq } from "drizzle-orm";
import { chambers, getDb, jurisdictions } from "./index";

// Reference data that never comes from a scraper. Idempotent: re-running just
// no-ops on existing rows.
const SEED = [
  {
    code: "federal" as const,
    name: "Commonwealth of Australia",
    chambers: [
      { kind: "lower" as const, name: "House of Representatives", membersPerVoter: 1 },
      { kind: "upper" as const, name: "Senate", membersPerVoter: 12 },
    ],
  },
  {
    code: "nsw" as const,
    name: "New South Wales",
    chambers: [
      { kind: "lower" as const, name: "Legislative Assembly", membersPerVoter: 1 },
      { kind: "upper" as const, name: "Legislative Council", membersPerVoter: 21 },
    ],
  },
  {
    code: "vic" as const,
    name: "Victoria",
    chambers: [
      { kind: "lower" as const, name: "Legislative Assembly", membersPerVoter: 1 },
      { kind: "upper" as const, name: "Legislative Council", membersPerVoter: 5 },
    ],
  },
  {
    code: "qld" as const,
    name: "Queensland",
    chambers: [
      { kind: "unicameral" as const, name: "Legislative Assembly", membersPerVoter: 1 },
    ],
  },
  {
    code: "wa" as const,
    name: "Western Australia",
    chambers: [
      { kind: "lower" as const, name: "Legislative Assembly", membersPerVoter: 1 },
      { kind: "upper" as const, name: "Legislative Council", membersPerVoter: 37 },
    ],
  },
  {
    code: "sa" as const,
    name: "South Australia",
    chambers: [
      { kind: "lower" as const, name: "House of Assembly", membersPerVoter: 1 },
      { kind: "upper" as const, name: "Legislative Council", membersPerVoter: 22 },
    ],
  },
  {
    code: "tas" as const,
    name: "Tasmania",
    chambers: [
      { kind: "lower" as const, name: "House of Assembly", membersPerVoter: 7 },
      { kind: "upper" as const, name: "Legislative Council", membersPerVoter: 1 },
    ],
  },
  {
    code: "act" as const,
    name: "Australian Capital Territory",
    chambers: [
      { kind: "unicameral" as const, name: "Legislative Assembly", membersPerVoter: 5 },
    ],
  },
  {
    code: "nt" as const,
    name: "Northern Territory",
    chambers: [
      { kind: "unicameral" as const, name: "Legislative Assembly", membersPerVoter: 1 },
    ],
  },
];

async function main() {
  const db = getDb();
  for (const j of SEED) {
    const [existing] = await db
      .select()
      .from(jurisdictions)
      .where(eq(jurisdictions.code, j.code))
      .limit(1);
    const jurisdictionRow =
      existing ??
      (
        await db
          .insert(jurisdictions)
          .values({ code: j.code, name: j.name })
          .returning()
      )[0];
    if (!jurisdictionRow) throw new Error(`failed to upsert jurisdiction ${j.code}`);

    const existingChambers = await db
      .select()
      .from(chambers)
      .where(eq(chambers.jurisdictionId, jurisdictionRow.id));
    for (const c of j.chambers) {
      if (existingChambers.some((r) => r.kind === c.kind)) continue;
      await db.insert(chambers).values({
        jurisdictionId: jurisdictionRow.id,
        kind: c.kind,
        name: c.name,
        membersPerVoter: c.membersPerVoter,
      });
    }
  }
  console.log("Seed applied.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
