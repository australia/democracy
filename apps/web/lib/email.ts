// Pluggable email transport. Dev mode writes JSON files to
// data/captured-mail/ so nothing escapes; prod mode uses SES.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface EmailIn {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
  meta?: Record<string, unknown>;
}

export interface SendResult {
  transportId: string;
  success: boolean;
  error?: string;
}

export interface EmailTransport {
  name: string;
  send(msg: EmailIn): Promise<SendResult>;
}

const CAPTURED_DIR =
  process.env.CAPTURED_MAIL_DIR ??
  join(process.cwd(), "..", "..", "data", "captured-mail");

function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const captured: EmailTransport = {
  name: "captured",
  async send(msg) {
    await mkdir(CAPTURED_DIR, { recursive: true });
    const id = `${ts()}-${Math.random().toString(36).slice(2, 8)}`;
    const file = join(CAPTURED_DIR, `${id}.json`);
    await writeFile(file, JSON.stringify(msg, null, 2), "utf8");
    return { transportId: id, success: true };
  },
};

// SES transport — only loaded if needed, so the dev path doesn't pull the
// aws-sdk into the bundle.
async function makeSES(): Promise<EmailTransport> {
  const { SESClient, SendEmailCommand } = await import("@aws-sdk/client-ses");
  const client = new SESClient({ region: process.env.SES_REGION });
  return {
    name: "ses",
    async send(msg) {
      try {
        const cmd = new SendEmailCommand({
          Source: msg.from,
          Destination: { ToAddresses: [msg.to] },
          ReplyToAddresses: msg.replyTo ? [msg.replyTo] : undefined,
          Message: {
            Subject: { Data: msg.subject, Charset: "UTF-8" },
            Body: { Text: { Data: msg.text, Charset: "UTF-8" } },
          },
        });
        const out = await client.send(cmd);
        return { transportId: out.MessageId ?? "unknown", success: true };
      } catch (err) {
        return {
          transportId: "",
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

export async function getTransport(): Promise<EmailTransport> {
  const choice = (process.env.EMAIL_TRANSPORT ?? "captured").toLowerCase();
  if (choice === "ses") return makeSES();
  return captured;
}
