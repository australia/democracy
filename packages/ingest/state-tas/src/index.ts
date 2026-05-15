import { applyRoster, fetchText, sleep, type RawRep } from "@au/ingest-shared";
import * as cheerio from "cheerio";

const BASE = "https://www.parliament.tas.gov.au";
const HOA_LIST = `${BASE}/house-of-assembly/currentmembers`;
const LC_LIST = `${BASE}/legislative-council/members`;

const HOA_ELECTORATES = ["Bass", "Braddon", "Clark", "Franklin", "Lyons"] as const;
// LC divisions are single-member; the full list as of 2025.
const LC_DIVISIONS = [
  "Derwent",
  "Elwick",
  "Hobart",
  "Huon",
  "Launceston",
  "McIntyre",
  "Mersey",
  "Montgomery",
  "Murchison",
  "Nelson",
  "Pembroke",
  "Prosser",
  "Rosevears",
  "Rumney",
  "Windermere",
] as const;
const PARTIES = [
  "Australian Labor Party",
  "Liberal Party",
  "Tasmanian Greens",
  "Jacqui Lambie Network",
  "Independent",
];

const HONORIFIC_RX =
  /^(The\s+Honourable|The\s+Hon|Hon|Dr|Mr|Mrs|Ms|Miss|Sir|Dame|Rev)\b\.?\s+/i;

function splitName(full: string) {
  let s = full.trim();
  const parts: string[] = [];
  while (true) {
    const m = s.match(HONORIFIC_RX);
    if (!m) break;
    parts.push(m[1]!);
    s = s.slice(m[0].length).trim();
  }
  s = s.replace(/\s+MP$|\s+MLC$/i, "").trim();
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

function memberLinksFromList(html: string, slugPrefix: string): string[] {
  const $ = cheerio.load(html);
  const set = new Set<string>();
  $("a").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const re = new RegExp(`${slugPrefix}/([a-z][a-z0-9-]+)$`);
    const m = href.match(re);
    if (m) set.add(new URL(href, BASE).toString());
  });
  return [...set];
}

interface MemberDetail {
  fullName: string;
  email?: string;
  electorate?: string;
  party?: string;
}

function parseDetail(html: string, electorates: readonly string[]): MemberDetail {
  const $ = cheerio.load(html);
  const title = $("h1").first().text().replace(/\s+/g, " ").trim();
  let email: string | undefined;
  $('a[href^="mailto:"]').each((_, a) => {
    const v = ($(a).attr("href") ?? "").replace(/^mailto:/i, "").trim();
    if (v && !email) email = v;
  });
  const bodyText = $("main, article, .content, body").first().text();
  const text = bodyText.replace(/\s+/g, " ");
  const electorate = electorates.find((e) =>
    new RegExp(`\\b${e}\\b`).test(text),
  );
  const party = PARTIES.find((p) => text.includes(p));
  return { fullName: title, email, electorate, party };
}

async function scrapeChamber(
  listUrl: string,
  slugPrefix: string,
  kind: "lower" | "upper",
  electorates: readonly string[],
): Promise<RawRep[]> {
  const html = await fetchText(listUrl);
  const links = memberLinksFromList(html, slugPrefix);
  console.log(`  TAS ${kind}: ${links.length} member URLs`);
  const out: RawRep[] = [];
  for (let i = 0; i < links.length; i++) {
    const link = links[i]!;
    const slug = link.split("/").pop()!;
    try {
      const detHtml = await fetchText(link);
      const det = parseDetail(detHtml, electorates);
      const { honorific, given, family } = splitName(det.fullName);
      out.push({
        externalId: slug,
        fullName: det.fullName,
        given,
        family,
        honorific,
        party: det.party,
        chamberKind: kind,
        electorateCode: det.electorate,
        stateCode: "TAS",
        profileUrl: link,
        primaryEmail: det.email,
        contactFormKind: "none",
      });
    } catch (err) {
      console.warn(`  failed ${slug}:`, err);
    }
    await sleep(350);
    if ((i + 1) % 10 === 0) console.log(`  fetched ${i + 1}/${links.length}`);
  }
  return out;
}

export async function run(
  mode: "lower" | "upper" | "all" | "dry",
): Promise<void> {
  const all: RawRep[] = [];
  if (mode === "lower" || mode === "all" || mode === "dry") {
    console.log("Fetching TAS House of Assembly");
    all.push(
      ...(await scrapeChamber(
        HOA_LIST,
        "/house-of-assembly/currentmembers",
        "lower",
        HOA_ELECTORATES,
      )),
    );
  }
  if (mode === "upper" || mode === "all" || mode === "dry") {
    console.log("Fetching TAS Legislative Council");
    all.push(
      ...(await scrapeChamber(
        LC_LIST,
        "/legislative-council/members",
        "upper",
        LC_DIVISIONS,
      )),
    );
  }

  if (mode === "dry") {
    console.log(JSON.stringify(all.slice(0, 3), null, 2));
    return;
  }

  await applyRoster(all, { jurisdictionCode: "tas" });
}
