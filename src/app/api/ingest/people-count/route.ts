import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { peopleCountIngestSchema } from "@/lib/zod-schemas/people-count-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * KisiSayimKopru (Hikvision kişi sayım kamerası) → DocuFlow köprüsü.
 *
 * Mağazadaki köprü, kameradan okuduğu saatlik giren/çıkan sayılarını gönderir;
 * (store_code, date, hour) üzerinden idempotent upsert edilir. Bearer token ile
 * korunur (NEBIM/DEFOLU köprüleriyle aynı INGEST_API_TOKEN).
 */
function configuredToken(): string {
  // .trim(): Vercel'e yapıştırırken sona eklenen boşluk/satır sonunu temizle.
  return (process.env.INGEST_API_TOKEN || "").trim();
}

const CHUNK = 50;

export async function POST(req: Request) {
  const token = configuredToken();
  const auth = (req.headers.get("authorization") || "").trim();
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = peopleCountIngestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { rows, source } = parsed.data;

  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    await Promise.all(
      part.map((r) =>
        prisma.peopleCountHour.upsert({
          where: {
            store_code_date_hour: {
              store_code: r.store_code,
              date: r.date,
              hour: r.hour,
            },
          },
          create: {
            store_code: r.store_code,
            date: r.date,
            hour: r.hour,
            enter: r.enter,
            exit: r.exit,
            ...(source ? { source } : {}),
          },
          update: {
            enter: r.enter,
            exit: r.exit,
            ...(source ? { source } : {}),
          },
        })
      )
    );
    upserted += part.length;
  }

  return NextResponse.json({ ok: true, received: rows.length, upserted });
}
