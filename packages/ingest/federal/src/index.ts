import { fetchText, sleep, type RawRep } from "@au/ingest-shared";
import * as cheerio from "cheerio";

const BASE = "https://www.aph.gov.au";

// `mem=1` filters to House of Representatives; `sen=1` filters to Senators.
// `ps=96` is the page size accepted by the site. `par=-1` means any party.
const LIST_URLS = {
  members: `${BASE}/Senators_and_Members/Parliamentarian_Search_Results?q=&mem=1&par=-1&gen=0&ps=96`,
  senators: `${BASE}/Senators_and_Members/Parliamentarian_Search_Results?q=&sen=1&par=-1&gen=0&ps=96`,
};

const STATE_BY_NAME: Record<string, RawRep["stateCode"]> = {
  "New South Wales": "NSW",
  Victoria: "VIC",
  Queensland: "QLD",
  "Western Australia": "WA",
  "South Australia": "SA",
  Tasmania: "TAS",
  "Australian Capital Territory": "ACT",
  "Northern Territory": "NT",
};

type ListEntry = {
  mpid: string;
  fullName: string;
  // `forText` is the raw value of the "For" definition:
  //   - MPs:      "Calwell, Victoria"
  //   - Senators: "Western Australia"
  forText?: string;
  party?: string;
  primaryEmail?: string;
  profileUrl: string;
  photoUrl?: string;
};

// Each member is rendered as <h4 class="title"><a href="...MPID=...">Name</a></h4>
// followed by <dl class="dl--inline__result"> with <dt>label</dt><dd>value</dd>
// pairs for "For", "Party", "Connect" (with a mailto: link inside), etc.
async function collectListEntries(startUrl: string): Promise<ListEntry[]> {
  const out: ListEntry[] = [];
  let url: string | null = startUrl;
  let safety = 0;
  while (url && safety++ < 50) {
    const html: string = await fetchText(url);
    const $ = cheerio.load(html);
    let foundOnPage = 0;

    $("dl.dl--inline__result").each((_, dl) => {
      const $dl = $(dl);

      // Find the title anchor. Usually it's the immediately preceding h4,
      // sometimes the structure puts h4 + dl as siblings inside a wrapper.
      let $a = $dl.prev("h4.title").find('a[href*="MPID="]').first();
      if (!$a.length) {
        $a = $dl.parent().find('h4.title a[href*="MPID="]').first();
      }
      if (!$a.length) return;
      const href = $a.attr("href") ?? "";
      const idMatch = href.match(/MPID=([A-Za-z0-9]+)/);
      if (!idMatch || !idMatch[1]) return;
      const mpid = idMatch[1];
      const fullName = $a.text().trim().replace(/\s+/g, " ");
      if (!fullName) return;

      // Walk dt/dd pairs. Multiple <dt> with the same label (e.g. several
      // "Positions") keep the first value; that's fine — we only care about
      // "For" and "Party".
      const data: Record<string, string> = {};
      $dl.find("dt").each((_, dt) => {
        const label = $(dt).text().trim();
        if (!label || label in data) return;
        const value = $(dt).next("dd").text().trim().replace(/\s+/g, " ");
        if (value) data[label] = value;
      });

      // Email lives as a <a href="mailto:..."> inside the Connect <dd>.
      let primaryEmail: string | undefined;
      $dl
        .find('dt:contains("Connect")')
        .next("dd")
        .find('a[href^="mailto:"]')
        .each((_, mail) => {
          const v = ($(mail).attr("href") ?? "").replace(/^mailto:/i, "").trim();
          if (v && !primaryEmail) primaryEmail = v;
        });

      const photo = $dl
        .parent()
        .find('img[src*="/api/parliamentarian"]')
        .attr("src");

      out.push({
        mpid,
        fullName,
        forText: data["For"],
        party: data["Party"],
        primaryEmail,
        profileUrl: `${BASE}/Senators_and_Members/Parliamentarian?MPID=${mpid}`,
        photoUrl: photo ? new URL(photo, BASE).toString() : undefined,
      });
      foundOnPage++;
    });

    const nextHref = $('a:contains("Next")').attr("href");
    if (foundOnPage === 0 || !nextHref) break;
    url = new URL(nextHref, BASE).toString();
    await sleep(750);
  }
  // Dedup by MPID just in case the same card appears twice on a page.
  const seen = new Map<string, ListEntry>();
  for (const e of out) if (!seen.has(e.mpid)) seen.set(e.mpid, e);
  return [...seen.values()];
}

const STATE_NAMES = new Set(Object.keys(STATE_BY_NAME));

function parseForText(
  raw: string | undefined,
  chamberKind: "lower" | "upper",
): { electorate?: string; state?: string } {
  if (!raw) return {};
  if (chamberKind === "upper") {
    return STATE_NAMES.has(raw) ? { state: raw } : {};
  }
  // MPs: "Electorate, State"
  const idx = raw.lastIndexOf(",");
  if (idx === -1) return { electorate: raw };
  const electorate = raw.slice(0, idx).trim();
  const state = raw.slice(idx + 1).trim();
  return { electorate, state: STATE_NAMES.has(state) ? state : undefined };
}

/**
 * Federal email patterns observed across past parliaments. We try the contact
 * form page first (it occasionally exposes a mailto link); else we fall back
 * to pattern construction with a `verified=false` flag so we can scrub it
 * later. Bounces on first send mark the address bad and route to the form.
 */
function deriveEmailGuess(rep: { given?: string; family?: string; chamberKind: RawRep["chamberKind"] }): string | undefined {
  const given = rep.given?.replace(/[^A-Za-z-]/g, "");
  const family = rep.family?.replace(/[^A-Za-z-]/g, "");
  if (!given || !family) return undefined;
  if (rep.chamberKind === "upper") {
    return `senator.${family.toLowerCase()}@aph.gov.au`;
  }
  return `${given}.${family}.MP@aph.gov.au`;
}

// Strip every leading honorific (handles stacks like "Hon Dr Anne Aly MP" and
// "Senator the Hon David Pocock") and the trailing "MP" suffix; what's left is
// given + family.
const HONORIFIC_RX =
  /^(Senator(?:\s+the\s+Hon)?|Rt\s+Hon|The\s+Hon|Hon|Dr|Mr|Mrs|Ms|Miss|Sir|Dame|Lord|Lady|Rev)\b\.?\s+/i;

function splitName(full: string): { honorific?: string; given?: string; family?: string } {
  let s = full.trim();
  const parts: string[] = [];
  while (true) {
    const m = s.match(HONORIFIC_RX);
    if (!m) break;
    parts.push(m[1]!.replace(/\s+/g, " "));
    s = s.slice(m[0].length).trim();
  }
  s = s.replace(/\s+MP$/i, "").trim();
  const tokens = s.split(/\s+/).filter(Boolean);
  const honorific = parts.length ? parts.join(" ") : undefined;
  if (tokens.length === 0) return { honorific };
  if (tokens.length === 1) return { honorific, family: tokens[0] };
  const family = tokens[tokens.length - 1];
  const given = tokens.slice(0, -1).join(" ");
  return { honorific, given, family };
}

export async function run(mode: "members" | "senators" | "all" | "dry"): Promise<void> {
  const tasks: Array<{ chamberKind: "lower" | "upper"; listUrl: string }> = [];
  if (mode === "members" || mode === "all" || mode === "dry") {
    tasks.push({ chamberKind: "lower", listUrl: LIST_URLS.members });
  }
  if (mode === "senators" || mode === "all" || mode === "dry") {
    tasks.push({ chamberKind: "upper", listUrl: LIST_URLS.senators });
  }

  const raw: RawRep[] = [];
  for (const t of tasks) {
    console.log(`Fetching list for ${t.chamberKind} from ${t.listUrl}`);
    const entries = await collectListEntries(t.listUrl);
    console.log(`  ${entries.length} entries`);

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      const { honorific, given, family } = splitName(e.fullName);
      const { electorate, state } = parseForText(e.forText, t.chamberKind);
      const stateCode = state ? STATE_BY_NAME[state] : undefined;

      const rep: RawRep = {
        externalId: e.mpid,
        fullName: e.fullName,
        given,
        family,
        honorific,
        party: e.party,
        chamberKind: t.chamberKind,
        electorateCode: t.chamberKind === "lower" ? electorate : undefined,
        // Set state on EVERY federal rep — the list page gives us
        // "For Electorate, State" for MPs and "For State" for Senators. Having
        // a state on MPs as well lets a lookup-by-point match senators of the
        // same state without a separate state-from-electorate join.
        stateCode,
        photoUrl: e.photoUrl,
        profileUrl: e.profileUrl,
        // Real published mailto wins; fall back to pattern only if the page
        // omits it.
        primaryEmail:
          e.primaryEmail ??
          deriveEmailGuess({ given, family, chamberKind: t.chamberKind }),
        contactFormUrl: `${BASE}/Senators_and_Members/Contact_Senator_or_Member?MPID=${e.mpid}`,
        contactFormKind: "aph",
      };
      raw.push(rep);
    }
  }

  if (mode === "dry") {
    console.log(JSON.stringify(raw, null, 2));
    return;
  }

  // Apply: write audit row and upsert. Import lazily so `dry` mode doesn't
  // need a DATABASE_URL.
  const { apply } = await import("./apply");
  await apply(raw);
}
