import { applyRoster, fetchText, type RawRep } from "@au/ingest-shared";
import * as cheerio from "cheerio";

const BASE = "https://www.parliament.wa.gov.au";
const URL_LA = `${BASE}/parliament/memblist.nsf/WebCurrentMembLA`;
const URL_LC = `${BASE}/parliament/memblist.nsf/WebCurrentMembLC`;

const PARTY_LONG: Record<string, string> = {
  ALP: "Australian Labor Party",
  LIB: "Liberal Party of Australia",
  NAT: "The Nationals WA",
  GWA: "Greens WA",
  GRN: "Greens WA",
  ONP: "Pauline Hanson's One Nation",
  IND: "Independent",
  LDP: "Liberal Democrats",
};

const HONORIFIC_RX =
  /^(Senator(?:\s+the\s+Hon)?|Rt\s+Hon|The\s+Hon|Hon|Dr|Mr|Mrs|Ms|Miss|Sir|Dame|Lord|Lady|Rev)\b\.?\s+/i;

function parseMember(td1: string): {
  honorific?: string;
  given?: string;
  family?: string;
  party?: string;
  chamberKind: "lower" | "upper";
} | undefined {
  // td1 looks like "Mr Stuart AUBREY MLAParty: ALP" but ministers' rows omit
  // the space before role text, e.g.
  //   "Hon Hannah BEAZLEY MLAMinister for Local Government; …Party: ALP"
  // So we anchor on the "MLA"/"MLC" marker itself: name is whatever comes
  // before it; role text comes after; party is `Party: XYZ` anywhere.
  const text = td1.replace(/\s+/g, " ").trim();
  // Anchor on the chamber marker: the name is whatever sits before
  // " MLA" / " MLC" (with a preceding space, regardless of what follows —
  // since ministers' rows often have "MLAMinister …" with no separator).
  const m = text.match(/^(.+?)\s+(MLA|MLC)(?=[A-Z]|$|\s)/);
  if (!m || m.index === undefined) return undefined;
  const markerIdx = m[1]!.length + 1; // position of marker
  return parseNameAndParty(text, markerIdx, m[2]! as "MLA" | "MLC");
}

function parseNameAndParty(
  text: string,
  markerIdx: number,
  marker: "MLA" | "MLC",
): {
  honorific?: string;
  given?: string;
  family?: string;
  party?: string;
  chamberKind: "lower" | "upper";
} {
  const chamberKind: "lower" | "upper" = marker === "MLC" ? "upper" : "lower";
  const before = text.slice(0, markerIdx).trim();
  const after = text.slice(markerIdx + 3);
  const partyMatch = after.match(/Party:\s*([A-Z]+)/);
  const party = partyMatch
    ? PARTY_LONG[partyMatch[1]!] ?? partyMatch[1]
    : undefined;

  let s = before;
  let honorific: string | undefined;
  while (true) {
    const m = s.match(HONORIFIC_RX);
    if (!m) break;
    honorific = honorific ? `${honorific} ${m[1]!}` : m[1]!;
    s = s.slice(m[0].length).trim();
  }
  const tokens = s.split(/\s+/).filter(Boolean);
  const familyIdx = tokens.findIndex((t) => /^[A-Z'-]+$/.test(t) && t.length > 1);
  let given: string | undefined;
  let family: string | undefined;
  if (familyIdx === -1) {
    family = tokens[tokens.length - 1];
    given = tokens.slice(0, -1).join(" ") || undefined;
  } else {
    family = tokens.slice(familyIdx).map(toTitleCase).join(" ");
    given = tokens.slice(0, familyIdx).join(" ") || undefined;
  }
  return { honorific, given, family, party, chamberKind };
}

function toTitleCase(s: string): string {
  return s
    .split(/(['-])/)
    .map((part) =>
      /['-]/.test(part) ? part : part[0]?.toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join("");
}

async function scrape(url: string): Promise<RawRep[]> {
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const out: RawRep[] = [];

  $("tr").each((_, tr) => {
    const $tr = $(tr);
    if ($tr.find('a[href^="mailto:"]').length === 0) return;
    const tds = $tr.find("td");
    if (tds.length < 4) return;
    const td1 = tds.eq(1).text();
    const electorate = tds.eq(2).text().replace(/\s+/g, " ").trim();
    let primaryEmail: string | undefined;
    $tr
      .find('a[href^="mailto:"]')
      .each((_, a) => {
        const v = ($(a).attr("href") ?? "")
          .replace(/^mailto:/i, "")
          .trim();
        if (v && !primaryEmail) primaryEmail = v;
      });
    const parsed = parseMember(td1);
    if (!parsed) return;
    const fullName = [parsed.honorific, parsed.given, parsed.family]
      .filter(Boolean)
      .join(" ");
    const stateWide = electorate.toLowerCase().includes("western australia");
    out.push({
      externalId: primaryEmail ?? `${parsed.family}-${parsed.given}`.toLowerCase(),
      fullName,
      given: parsed.given,
      family: parsed.family,
      honorific: parsed.honorific,
      party: parsed.party,
      chamberKind: parsed.chamberKind,
      electorateCode:
        parsed.chamberKind === "lower" && !stateWide ? electorate : undefined,
      stateCode: "WA",
      primaryEmail,
      contactFormKind: "none",
    });
  });
  // Dedup by externalId
  const seen = new Map<string, RawRep>();
  for (const r of out) if (!seen.has(r.externalId)) seen.set(r.externalId, r);
  return [...seen.values()];
}

export async function run(
  mode: "lower" | "upper" | "all" | "dry",
): Promise<void> {
  const all: RawRep[] = [];

  if (mode === "lower" || mode === "all" || mode === "dry") {
    console.log("Fetching WA Legislative Assembly");
    const rows = await scrape(URL_LA);
    console.log(`  ${rows.length} MLAs`);
    all.push(...rows);
  }
  if (mode === "upper" || mode === "all" || mode === "dry") {
    console.log("Fetching WA Legislative Council");
    const rows = await scrape(URL_LC);
    console.log(`  ${rows.length} MLCs`);
    all.push(...rows);
  }

  if (mode === "dry") {
    console.log(JSON.stringify(all.slice(0, 3), null, 2));
    return;
  }

  await applyRoster(all, { jurisdictionCode: "wa" });
}
