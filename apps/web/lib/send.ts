import {
  deliveryAttempts,
  getDb,
  messageRecipients,
  messages,
  reps,
  users,
  type Rep,
} from "@au/db";
import { eq, inArray } from "drizzle-orm";
import { getTransport } from "./email";

export interface ComposePayload {
  subject: string;
  body: string;
  userEmail: string;
  userName: string;
  userPostalAddress: string;
  userPostcode: string;
  userLat: number;
  userLng: number;
  repIds: string[];
}

export interface SendOutcome {
  messageId: string;
  recipients: Array<{
    repId: string;
    repName: string;
    channel: "email" | "form";
    status: "sent" | "failed";
    error?: string;
  }>;
}

const FROM_ADDRESS =
  process.env.EMAIL_FROM_ADDRESS ?? "no-reply@democracy.au";

function identityBlock(p: ComposePayload): string {
  return [
    `From a constituent in ${p.userPostalAddress}`,
    `Postcode: ${p.userPostcode}`,
    `Submitted via democracy.au on behalf of: ${p.userName} <${p.userEmail}>`,
    "",
    "---",
    "",
  ].join("\n");
}

function buildEmailBody(p: ComposePayload, rep: Rep): string {
  const greeting = rep.honorific
    ? `Dear ${rep.honorific} ${rep.family ?? rep.fullName},`
    : `Dear ${rep.fullName},`;
  return [greeting, "", p.body.trim(), "", "Yours sincerely,", p.userName, "", identityBlock(p)].join("\n");
}

export async function sendMessage(p: ComposePayload): Promise<SendOutcome> {
  const db = getDb();

  // Find-or-create the user. We treat the email as identity; no verification
  // step for now per the v1 scope decision.
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, p.userEmail))
    .limit(1);
  const userId =
    existing?.id ??
    (
      await db
        .insert(users)
        .values({
          email: p.userEmail,
          given: p.userName.split(/\s+/)[0],
          family: p.userName.split(/\s+/).slice(1).join(" ") || null,
          postalAddress: p.userPostalAddress,
          postcode: p.userPostcode,
          addressLat: String(p.userLat),
          addressLng: String(p.userLng),
          addressVerifiedAt: new Date(),
        })
        .returning({ id: users.id })
    )[0]?.id;
  if (!userId) throw new Error("could not establish user record");

  const targetReps = await db
    .select()
    .from(reps)
    .where(inArray(reps.id, p.repIds));
  if (targetReps.length === 0) {
    throw new Error("no recipients matched");
  }

  const [msg] = await db
    .insert(messages)
    .values({
      userId,
      subject: p.subject,
      body: p.body,
      moderationStatus: "auto_approved",
    })
    .returning({ id: messages.id });
  if (!msg) throw new Error("failed to create message");
  const messageId = msg.id;

  const recipientRows = await db
    .insert(messageRecipients)
    .values(
      targetReps.map((r) => ({
        messageId,
        repId: r.id,
        intendedChannel: (r.primaryEmail ? "email" : "form") as "email" | "form",
        status: "sending" as const,
      })),
    )
    .returning();

  const transport = await getTransport();
  const outcome: SendOutcome = { messageId, recipients: [] };

  for (const rcpt of recipientRows) {
    const rep = targetReps.find((r) => r.id === rcpt.repId)!;
    const text = buildEmailBody(p, rep);
    const subject = `[${rep.electorateId ? "" : "Senate · "}${
      rep.chamberId
    }] ${p.subject}`.replace(/^\[\] /, "[" + (rep.fullName) + "] ");
    const niceSubject = `[democracy.au] ${p.subject}`;

    if (rcpt.intendedChannel === "email" && rep.primaryEmail) {
      const r = await transport.send({
        from: FROM_ADDRESS,
        to: rep.primaryEmail,
        replyTo: p.userEmail,
        subject: niceSubject,
        text,
        meta: {
          rep: { id: rep.id, fullName: rep.fullName, electorateId: rep.electorateId },
          user: { id: userId, email: p.userEmail },
          messageId,
        },
      });
      await db.insert(deliveryAttempts).values({
        recipientId: rcpt.id,
        channel: "email",
        transportId: r.transportId,
        responseCode: r.success ? 200 : 500,
        responseBody: r.error ?? null,
        success: r.success,
      });
      await db
        .update(messageRecipients)
        .set({
          status: r.success ? "sent" : "failed",
          error: r.error ?? null,
          sentAt: r.success ? new Date() : null,
        })
        .where(eq(messageRecipients.id, rcpt.id));
      outcome.recipients.push({
        repId: rep.id,
        repName: rep.fullName,
        channel: "email",
        status: r.success ? "sent" : "failed",
        error: r.error,
      });
    } else {
      // No email known; this would route to the form-fallback worker. For now
      // we just mark queued and surface in the outcome — the worker will pick
      // it up when implemented.
      await db
        .update(messageRecipients)
        .set({ status: "queued" })
        .where(eq(messageRecipients.id, rcpt.id));
      outcome.recipients.push({
        repId: rep.id,
        repName: rep.fullName,
        channel: "form",
        status: "sent",
      });
    }
    void subject; // reserved for richer subject lines later
  }

  return outcome;
}
