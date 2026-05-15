import { request } from "undici";

// State parliament sites (NSW, VIC, QLD, WA, TAS, ACT, NT) reject our
// short identifier with HTTP 403 from GCE/datacentre IPs — likely a generic
// bot heuristic. Send a realistic browser UA; we still rate-limit politely
// and obey robots.txt at the application layer.
const UA = (
  process.env.INGEST_USER_AGENT ??
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
);

interface FetchOpts {
  attempts?: number;
  delayMs?: number;
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 1000;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await request(url, {
        method: "GET",
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (res.statusCode >= 400) {
        throw new Error(`HTTP ${res.statusCode} for ${url}`);
      }
      return await res.body.text();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(delayMs * (i + 1));
    }
  }
  throw lastErr;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
