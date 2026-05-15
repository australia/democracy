import { applyRoster, fetchText, sleep, type RawRep } from "@au/ingest-shared";
import * as cheerio from "cheerio";
import { request } from "undici";

const BASE = "https://www.parliament.vic.gov.au";

// `member-house=10` = Legislative Assembly (lower), `20` = Legislative Council (upper)
const API = `${BASE}/api/search/members`;

interface Membership {
  title: string;
  details: string[];
}
interface MemberHit {
  id: string;
  title: string; // full name
  url: string;
  house: string;
  image?: { src?: string };
  memberships?: Membership[];
}
interface SearchResp {
  result?: { totalMatching?: number; hits?: MemberHit[] };
}

const STATE_CODE = "VIC" as const;

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
  s = s.replace(/\s+MLA$|\s+MLC$|\s+MP$/i, "").trim();
  const tokens = s.split(/\s+/).filter(Boolean);
  const honorific = parts.length ? parts.join(" ") : undefined;
  if (tokens.length === 0) return { honorific };
  if (tokens.length === 1) return { honorific, family: tokens[0] };
  const family = tokens[tokens.length - 1];
  const given = tokens.slice(0, -1).join(" ");
  return { honorific, given, family };
}

function getMembership(m: MemberHit, label: string): string | undefined {
  const found = m.memberships?.find(
    (x) => x.title.toLowerCase() === label.toLowerCase(),
  );
  return found?.details[0];
}

async function fetchHouse(house: "10" | "20"): Promise<MemberHit[]> {
  const url = `${API}?member-house=${house}&member-status=current&page=1&pageSize=200`;
  const res = await request(url, {
    headers: {
      "user-agent":
        process.env.INGEST_USER_AGENT ??
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      accept: "application/json",
    },
  });
  if (res.statusCode >= 400) {
    throw new Error(`VIC ${house} fetch failed HTTP ${res.statusCode}`);
  }
  const json = (await res.body.json()) as SearchResp;
  return json.result?.hits ?? [];
}

async function fetchEmail(memberUrl: string): Promise<string | undefined> {
  try {
    const html = await fetchText(new URL(memberUrl, BASE).toString());
    const $ = cheerio.load(html);
    let email: string | undefined;
    $('a[href^="mailto:"]').each((_, a) => {
      const v = ($(a).attr("href") ?? "").replace(/^mailto:/i, "").trim();
      if (v && !email) email = v;
    });
    return email;
  } catch {
    return undefined;
  }
}

export async function run(mode: "lower" | "upper" | "all" | "dry"): Promise<void> {
  const houses: Array<{ kind: "lower" | "upper"; house: "10" | "20" }> = [];
  if (mode === "lower" || mode === "all" || mode === "dry") {
    houses.push({ kind: "lower", house: "10" });
  }
  if (mode === "upper" || mode === "all" || mode === "dry") {
    houses.push({ kind: "upper", house: "20" });
  }

  const out: RawRep[] = [];
  for (const h of houses) {
    console.log(`Fetching VIC ${h.kind} chamber (member-house=${h.house})`);
    const hits = await fetchHouse(h.house);
    console.log(`  ${hits.length} members`);
    for (let i = 0; i < hits.length; i++) {
      const m = hits[i]!;
      const electorate =
        getMembership(m, "Member for") ??
        getMembership(m, "Region") ??
        getMembership(m, "Member for region");
      const party = getMembership(m, "Party");
      const { honorific, given, family } = splitName(m.title);
      const photo = m.image?.src ? new URL(m.image.src, BASE).toString() : undefined;
      const profileUrl = new URL(m.url, BASE).toString();

      const primaryEmail = mode === "dry" ? undefined : await fetchEmail(m.url);
      if (mode !== "dry") await sleep(400);

      out.push({
        externalId: m.id,
        fullName: m.title,
        given,
        family,
        honorific,
        party,
        chamberKind: h.kind,
        electorateCode: electorate,
        stateCode: STATE_CODE,
        photoUrl: photo,
        profileUrl,
        primaryEmail,
        contactFormKind: "none",
      });

      if ((i + 1) % 25 === 0) console.log(`  parsed ${i + 1}/${hits.length}`);
    }
  }

  if (mode === "dry") {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  await applyRoster(out, { jurisdictionCode: "vic" });
}
