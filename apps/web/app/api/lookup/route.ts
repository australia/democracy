import { NextResponse } from "next/server";
import { z } from "zod";
import { geocode } from "@/lib/geocode";
import { lookupRepsByPoint } from "@/lib/lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  address: z.string().trim().min(3).max(300).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    address: url.searchParams.get("address") ?? undefined,
    lat: url.searchParams.get("lat") ?? undefined,
    lng: url.searchParams.get("lng") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error.flatten() }, { status: 400 });
  }

  let lat = parsed.data.lat ?? null;
  let lng = parsed.data.lng ?? null;
  let matched: string | undefined;

  if (lat == null || lng == null) {
    if (!parsed.data.address) {
      return NextResponse.json(
        { error: "address_required", detail: "Provide address= or lat= & lng=." },
        { status: 400 },
      );
    }
    const g = await geocode(parsed.data.address);
    if (!g) {
      return NextResponse.json(
        { error: "geocode_failed", detail: "Could not locate that address in Australia." },
        { status: 404 },
      );
    }
    lat = g.lat;
    lng = g.lng;
    matched = g.matched;
  }

  const result = await lookupRepsByPoint(lng, lat);
  if (result.reps.length === 0) {
    return NextResponse.json(
      { error: "no_reps", detail: "No representatives found for that point. Address may be outside Australia or in waters." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    point: { lat, lng },
    matched,
    electorates: result.electorates,
    stateCode: result.stateCode,
    reps: result.reps,
  });
}
