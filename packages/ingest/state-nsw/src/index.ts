import { applyRoster, fetchText, type RawRep } from "@au/ingest-shared";
import * as cheerio from "cheerio";

const BASE = "https://www.parliament.nsw.gov.au";
// The `house=` query param is just a client-side filter; the page returns the
// full roster in one table either way. We fetch once and partition by the
// per-row "LA"/"LC" cell.
const LIST_URL = `${BASE}/members/Pages/all-members.aspx`;

// Cloudflare's `[data-cfemail]` attribute: hex string where the first byte is
// an XOR key and each subsequent byte is XORed against it. The decoded result
// is the actual email string.
function decodeCfEmail(hex: string): string {
  if (hex.length < 2) return "";
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i + 1 < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  }
  return out;
}

const HONORIFIC_RX =
  /^(The\s+Hon|Hon|Dr|Mr|Mrs|Ms|Miss|Sir|Dame|Rev)\b\.?\s+/i;

function parseLastFirst(s: string): { given?: string; family?: string } {
  // "Aitchison, Jenny"
  const m = s.match(/^([^,]+),\s+(.+)$/);
  if (!m) return {};
  return { family: m[1]!.trim(), given: m[2]!.trim() };
}

async function fetchAll(): Promise<RawRep[]> {
  const html = await fetchText(LIST_URL);
  const $ = cheerio.load(html);
  const out: RawRep[] = [];

  $("table tr").each((_, tr) => {
    const $tr = $(tr);
    const $a = $tr.find('a[href*="Member-details"]').first();
    if (!$a.length) return;
    const href = $a.attr("href") ?? "";
    const idMatch = href.match(/pk=(\d+)/i);
    if (!idMatch) return;
    const externalId = idMatch[1]!;

    const tds = $tr.find("td");
    const houseCell = tds.eq(4).text().trim().toUpperCase();
    const kind: "lower" | "upper" | null =
      houseCell === "LA" ? "lower" : houseCell === "LC" ? "upper" : null;
    if (!kind) return;

    const nameRaw = tds.eq(0).text().replace(/\s+/g, " ").trim();
    let { given, family } = parseLastFirst(nameRaw);
    let honorific: string | undefined;
    if (given) {
      const m = given.match(HONORIFIC_RX);
      if (m) {
        honorific = m[1]!;
        given = given.slice(m[0].length).trim();
      }
    }
    const fullName = [honorific, given, family].filter(Boolean).join(" ");

    const meta = tds.eq(1).text().replace(/\s+/g, " ").trim();
    const elecMatch = meta.match(
      /Member for ([^•]+?)(?:\s+(?:Minister|Shadow|Parliamentary|Speaker|Deputy|Whip|Leader|President|Chair|Treasurer|Premier|Australian|Liberal|National|Greens|Independent|Country|Labor|One|Pauline|Animal|Legalise|Sustainable|Shooters|Fishers|Farmers)\b|$)/,
    );
    const electorate = kind === "lower" ? elecMatch?.[1]?.trim() : undefined;

    const party = tds.eq(6).text().replace(/\s+/g, " ").trim() || undefined;

    let primaryEmail: string | undefined;
    $tr.find("[data-cfemail]").each((_, el) => {
      const hex = $(el).attr("data-cfemail") ?? "";
      const decoded = decodeCfEmail(hex);
      if (decoded && !primaryEmail) primaryEmail = decoded;
    });

    out.push({
      externalId,
      fullName,
      given,
      family,
      honorific,
      party,
      chamberKind: kind,
      electorateCode: electorate,
      stateCode: "NSW",
      profileUrl: new URL(href, BASE).toString(),
      primaryEmail,
      contactFormKind: "none",
    });
  });

  const seen = new Map<string, RawRep>();
  for (const r of out) if (!seen.has(r.externalId)) seen.set(r.externalId, r);
  return [...seen.values()];
}

export async function run(
  mode: "lower" | "upper" | "all" | "dry",
): Promise<void> {
  console.log("Fetching NSW all-members table");
  const all = await fetchAll();
  const lower = all.filter((r) => r.chamberKind === "lower");
  const upper = all.filter((r) => r.chamberKind === "upper");
  console.log(`  ${lower.length} LA, ${upper.length} LC`);

  let out: RawRep[];
  if (mode === "lower") out = lower;
  else if (mode === "upper") out = upper;
  else out = all;

  if (mode === "dry") {
    console.log(JSON.stringify(out.slice(0, 3), null, 2));
    return;
  }

  await applyRoster(out, { jurisdictionCode: "nsw" });
}
