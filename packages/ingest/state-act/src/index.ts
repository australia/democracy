import { applyRoster, fetchText, type RawRep } from "@au/ingest-shared";
import * as cheerio from "cheerio";

const BASE = "https://www.parliament.act.gov.au";
const LIST_URL = `${BASE}/members/current`;

const PARTY_LONG: Record<string, string> = {
  Labor: "Australian Labor Party",
  Liberal: "Canberra Liberals",
  Greens: "ACT Greens",
  Independent: "Independent",
};

export async function run(dryRun: boolean): Promise<void> {
  console.log("Fetching ACT member list");
  const html = await fetchText(LIST_URL);
  const $ = cheerio.load(html);

  const rows: RawRep[] = [];

  $("tr").each((_, tr) => {
    const $tr = $(tr);
    if ($tr.find('a[href^="mailto:"]').length === 0) return;

    const tds = $tr.find("td");
    if (tds.length < 3) return;
    const $a = tds.eq(0).find("a").first();
    const slugMatch = ($a.attr("href") ?? "").match(/\/members\/current\/([^/]+)/);
    const slug = slugMatch?.[1];
    if (!slug) return;

    // Inside td[0]: "<img/>Firstname <strong>Lastname</strong>"
    const given = $a
      .clone()
      .find("strong, img, br, span")
      .remove()
      .end()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const family = $a.find("strong").first().text().trim();
    const fullName = [given, family].filter(Boolean).join(" ");
    if (!fullName) return;

    const electorate = tds.eq(1).text().replace(/\s+/g, " ").trim();
    const partyRaw = tds
      .eq(2)
      .text()
      .replace(/[⬤●•]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const party = PARTY_LONG[partyRaw] ?? partyRaw;

    let primaryEmail: string | undefined;
    tds.eq(3)
      .find('a[href^="mailto:"]')
      .each((_, mail) => {
        const v = ($(mail).attr("href") ?? "").replace(/^mailto:/i, "").trim();
        if (v && !primaryEmail) primaryEmail = v;
      });

    rows.push({
      externalId: slug,
      fullName,
      given: given || undefined,
      family: family || undefined,
      party,
      chamberKind: "unicameral",
      electorateCode: electorate || undefined,
      stateCode: "ACT",
      profileUrl: $a.attr("href"),
      primaryEmail,
      contactFormKind: "none",
    });
  });

  console.log(`  ${rows.length} members`);

  if (dryRun) {
    console.log(JSON.stringify(rows.slice(0, 3), null, 2));
    return;
  }

  await applyRoster(rows, { jurisdictionCode: "act" });
}
