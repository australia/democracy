import { applyRoster, fetchText, type RawRep } from "@au/ingest-shared";
import * as cheerio from "cheerio";

const BASE = "https://www.parliament.qld.gov.au";
const LIST_URL = `${BASE}/Members/Current-Members/Member-List`;

const HONORIFIC_RX =
  /^(Senator(?:\s+the\s+Hon)?|Rt\s+Hon|The\s+Hon|Hon|Dr|Mr|Mrs|Ms|Miss|Sir|Dame|Lord|Lady|Rev)\b\.?\s+/i;

function splitName(full: string) {
  let s = full.trim();
  const parts: string[] = [];
  while (true) {
    const m = s.match(HONORIFIC_RX);
    if (!m) break;
    parts.push(m[1]!);
    s = s.slice(m[0].length).trim();
  }
  s = s.replace(/\s+MP$/i, "").trim();
  const tokens = s.split(/\s+/).filter(Boolean);
  const honorific = parts.length ? parts.join(" ") : undefined;
  if (tokens.length === 0) return { honorific };
  if (tokens.length === 1) return { honorific, family: tokens[0] };
  return {
    honorific,
    family: tokens[tokens.length - 1],
    given: tokens.slice(0, -1).join(" "),
  };
}

const PARTY_LONG: Record<string, string> = {
  ALP: "Australian Labor Party",
  LNP: "Liberal National Party of Queensland",
  KAP: "Katter's Australian Party",
  GRN: "Australian Greens",
  IND: "Independent",
  ONP: "Pauline Hanson's One Nation",
};

export async function run(dryRun: boolean): Promise<void> {
  console.log("Fetching QLD member list");
  const html = await fetchText(LIST_URL);
  const $ = cheerio.load(html);

  // Pre-index every `mailto:` on the page by lowercase electorate slug.
  // QLD's convention is `[Electorate]@parliament.qld.gov.au` (collapsed,
  // with hyphens preserved). We use this to attach emails to the right
  // member even though the mailto sits in a sibling block from the name.
  const mailByLocal = new Map<string, string>();
  $('a[href^="mailto:"]').each((_, a) => {
    const addr = ($(a).attr("href") ?? "").replace(/^mailto:/i, "").trim();
    const local = addr.split("@")[0]?.toLowerCase();
    if (local) mailByLocal.set(local, addr);
  });

  const seen = new Map<string, RawRep>();

  $('a[href*="Member-Details?id="]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") ?? "";
    const idMatch = href.match(/id=(\d+)/);
    if (!idMatch || !idMatch[1]) return;
    const id = idMatch[1];
    const name = $a.text().trim().replace(/\s+/g, " ");
    if (!name) return; // empty link (some anchors wrap photos)
    if (seen.has(id)) return; // first name-bearing anchor wins

    // Block containing this card — climb to find a parent that has both
    // the name text and the electorate text.
    const block = $a.closest("div,li,tr,article,section,td");
    const blockText = block.text().replace(/\s+/g, " ").trim();

    // Pattern: "<Honorific> <Name> Member for <Electorate> (<PARTY>)"
    const m = blockText.match(/Member for ([^()]+?)\s*\(([A-Z]+)\)/);
    const electorate = m?.[1]?.trim();
    const partyAbbr = m?.[2];
    const party = partyAbbr
      ? (PARTY_LONG[partyAbbr] ?? partyAbbr)
      : undefined;

    let primaryEmail: string | undefined;
    block.find('a[href^="mailto:"]').each((_, mail) => {
      const v = ($(mail).attr("href") ?? "").replace(/^mailto:/i, "").trim();
      if (v && !primaryEmail) primaryEmail = v;
    });
    if (!primaryEmail && electorate) {
      const slug = electorate.replace(/\s+/g, "").toLowerCase();
      primaryEmail = mailByLocal.get(slug);
    }

    const { honorific, given, family } = splitName(name);

    seen.set(id, {
      externalId: id,
      fullName: name,
      given,
      family,
      honorific,
      party,
      chamberKind: "unicameral",
      electorateCode: electorate,
      stateCode: "QLD",
      profileUrl: new URL(href, BASE).toString(),
      primaryEmail,
      contactFormKind: "none",
    });
  });

  const rows = [...seen.values()];
  console.log(`  ${rows.length} members`);

  if (dryRun) {
    console.log(JSON.stringify(rows.slice(0, 5), null, 2));
    console.log(`  total: ${rows.length}`);
    return;
  }

  await applyRoster(rows, { jurisdictionCode: "qld" });
}
