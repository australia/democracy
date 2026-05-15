import { applyRoster, fetchText, sleep, type RawRep } from "@au/ingest-shared";
import * as cheerio from "cheerio";

const BASE = "https://parliament.nt.gov.au";
const LIST_URL = `${BASE}/members/by-name`;

const PARTIES: Array<[RegExp, string]> = [
  [/\bCountry Liberal Party\b|\bCLP\b/, "Country Liberal Party"],
  [/\bAustralian Labor Party\b|\bALP\b/, "Australian Labor Party"],
  [/\bAustralian Greens\b/, "Australian Greens"],
  [/\bIndependent\b/, "Independent"],
];

// Canonical list of NT Legislative Assembly electorates (25 single-member
// divisions). Used to extract the electorate from page text since the regex
// otherwise picks up only the first word and trailing role text bleeds in.
const NT_ELECTORATES = [
  "Araluen",
  "Arafura",
  "Arnhem",
  "Barkly",
  "Blain",
  "Braitling",
  "Brennan",
  "Casuarina",
  "Daly",
  "Drysdale",
  "Fannie Bay",
  "Fong Lim",
  "Goyder",
  "Gwoja",
  "Johnston",
  "Karama",
  "Katherine",
  "Mulka",
  "Namatjira",
  "Nelson",
  "Nightcliff",
  "Port Darwin",
  "Sanderson",
  "Spillett",
  "Wanguri",
];

const HONORIFIC_RX =
  /^(The\s+Hon|Hon|Dr|Mr|Mrs|Ms|Miss|Sir|Dame|Rev)\b\.?\s+/i;

function splitName(full: string) {
  let s = full.trim().replace(/\s+OAM\b|\s+AM\b|\s+MLA\b/g, "");
  const parts: string[] = [];
  while (true) {
    const m = s.match(HONORIFIC_RX);
    if (!m) break;
    parts.push(m[1]!);
    s = s.slice(m[0].length).trim();
  }
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

export async function run(dryRun: boolean): Promise<void> {
  console.log("Fetching NT member list");
  const listHtml = await fetchText(LIST_URL);
  const $ = cheerio.load(listHtml);

  const links = new Map<string, { slug: string; name: string; url: string }>();
  $('a[href*="/members/by-name/"]').each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(/\/members\/by-name\/([a-z][a-z0-9-]+)$/);
    if (!m) return;
    const slug = m[1]!;
    if (links.has(slug)) return;
    const name = $(a).text().trim().replace(/\s+/g, " ");
    if (!name) return;
    links.set(slug, { slug, name, url: new URL(href, BASE).toString() });
  });

  console.log(`  ${links.size} members`);

  const out: RawRep[] = [];
  let i = 0;
  for (const { slug, name, url } of links.values()) {
    try {
      const html = await fetchText(url);
      const $2 = cheerio.load(html);
      let email: string | undefined;
      $2('a[href^="mailto:"]').each((_, a) => {
        const v = ($2(a).attr("href") ?? "").replace(/^mailto:/i, "").trim();
        if (!v) return;
        // Prefer the electorate.* address over a minister.* one.
        if (v.toLowerCase().startsWith("electorate.")) email = v;
        else if (!email) email = v;
      });

      const txt = $2("main, article, .content, body")
        .first()
        .text()
        .replace(/\s+/g, " ");
      // Match against the canonical list — longest names first so "Fong Lim"
      // wins over "Fong".
      const electorate = [...NT_ELECTORATES]
        .sort((a, b) => b.length - a.length)
        .find((e) => new RegExp(`\\b${e}\\b`, "i").test(txt));
      const party = PARTIES.find(([rx]) => rx.test(txt))?.[1];

      const { honorific, given, family } = splitName(name);
      out.push({
        externalId: slug,
        fullName: name,
        given,
        family,
        honorific,
        party,
        chamberKind: "unicameral",
        electorateCode: electorate,
        stateCode: "NT",
        profileUrl: url,
        primaryEmail: email,
        contactFormKind: "none",
      });
    } catch (err) {
      console.warn(`  failed ${slug}:`, err);
    }
    await sleep(300);
    if (++i % 10 === 0) console.log(`  fetched ${i}/${links.size}`);
  }

  if (dryRun) {
    console.log(JSON.stringify(out.slice(0, 3), null, 2));
    return;
  }

  await applyRoster(out, { jurisdictionCode: "nt" });
}
