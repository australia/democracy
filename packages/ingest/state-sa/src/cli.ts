// SA's parliament.sa.gov.au runs a Sitecore SPA — member rows are populated
// by JS post-load and there's no public list endpoint. Scraping needs a
// headless browser (Playwright). Until that's added, this CLI is a stub so
// the init pipeline can call every state scraper uniformly.
console.log("SA roster ingest: not yet implemented (needs Playwright). Skipping.");
process.exit(0);
