import { request } from "undici";

const UA =
  "democracy.au-roster-bot/0.1 (+https://democracy.au; respectful of robots.txt and rate limits)";

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
