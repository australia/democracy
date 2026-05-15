// Loads pre-scraped roster JSONs from disk into the DB. Used on deploy
// targets where state parliament sites block direct scraping (e.g. GCE
// us-central1 IPs hit HTTP 403 from parliament.{nsw,vic,qld,wa,tas,act}.gov.au).
//
// The JSONs are produced on a developer machine by running the per-state
// scraper, then `pnpm dump-rosters`. Re-running on a target is idempotent.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { applyRoster } from "./apply";
import type { RawRep } from "./types";

const SUPPORTED = new Set([
  "nsw",
  "vic",
  "qld",
  "sa",
  "wa",
  "tas",
  "act",
  "nt",
]);

async function main() {
  const dir = process.argv[2] ?? "/repo/data/rosters";
  const files = await readdir(dir).catch(() => [] as string[]);
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    const code = name.replace(/\.json$/, "");
    if (!SUPPORTED.has(code)) continue;
    const raw = await readFile(join(dir, name), "utf8");
    let parsed: RawRep[];
    try {
      parsed = JSON.parse(raw) as RawRep[];
    } catch {
      console.warn(`skip ${name}: not valid JSON`);
      continue;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.warn(`skip ${name}: empty or non-array`);
      continue;
    }
    console.log(`Importing ${code} from ${name} (${parsed.length} rows)`);
    await applyRoster(parsed, {
      jurisdictionCode: code as
        | "nsw"
        | "vic"
        | "qld"
        | "sa"
        | "wa"
        | "tas"
        | "act"
        | "nt",
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
