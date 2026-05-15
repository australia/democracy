import { NextResponse } from "next/server";
import { z } from "zod";
import { sendMessage } from "@/lib/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(20).max(20000),
  userEmail: z.string().email(),
  userName: z.string().trim().min(2).max(120),
  userPostalAddress: z.string().trim().min(4).max(300),
  userPostcode: z.string().regex(/^\d{4}$/),
  userLat: z.number().min(-90).max(90),
  userLng: z.number().min(-180).max(180),
  repIds: z.array(z.string().uuid()).min(1).max(20),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const outcome = await sendMessage(parsed.data);
    return NextResponse.json(outcome);
  } catch (err) {
    return NextResponse.json(
      { error: "send_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
