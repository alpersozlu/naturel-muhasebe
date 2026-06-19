import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { defoluIngestSchema, MAVI_STORE_CODES } from "@/lib/zod-schemas/defolu-ingest";
import { maviCodeFromName } from "@/server/services/masraf/dagitim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * İndirim Kontrol (mavi-iskonto-sistemi) → DocuFlow DEFOLU köprüsü (Faz 5).
 *
 * Aylık (ya da tüm yıl) Mavi mağaza defolu zarar toplamlarını alır, Mavi koduna
 * (9400-9403) çözer ve (year, month, store_code) üzerinden idempotent upsert eder.
 * Bearer token ile korunur (NEBIM köprüsüyle aynı INGEST_API_TOKEN).
 * Masraf matrisinde "DEFOLU" kategori satırını doldurur.
 */
function configuredToken(): string {
  // .trim(): Vercel'e yapıştırırken sona eklenen boşluk/satır sonunu temizle.
  return (process.env.INGEST_API_TOKEN || "").trim();
}

const MAVI_CODES = MAVI_STORE_CODES as readonly string[];

/** Bir satırı Mavi koduna çözer (store_code öncelikli, sonra store_name). */
function resolveMaviCode(e: {
  store_code?: string;
  store_name?: string;
}): string | null {
  if (e.store_code && MAVI_CODES.includes(e.store_code)) return e.store_code;
  if (e.store_name) {
    const byName = maviCodeFromName(e.store_name);
    if (byName) return byName;
  }
  // store_code aslında bir ad olabilir ("Lefkoşa") — son şans
  if (e.store_code) {
    const byCode = maviCodeFromName(e.store_code);
    if (byCode) return byCode;
  }
  return null;
}

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

  const parsed = defoluIngestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { year, entries } = parsed.data;

  let upserted = 0;
  const unmatched: { month: number; store: string }[] = [];

  for (const e of entries) {
    const code = resolveMaviCode(e);
    if (!code) {
      unmatched.push({ month: e.month, store: e.store_name ?? e.store_code ?? "?" });
      continue;
    }
    await prisma.defoluEntry.upsert({
      where: {
        period_year_period_month_store_code: {
          period_year: year,
          period_month: e.month,
          store_code: code,
        },
      },
      create: {
        period_year: year,
        period_month: e.month,
        store_code: code,
        amount_try: e.amount_try,
        source: "indirim-kontrol",
      },
      update: { amount_try: e.amount_try },
    });
    upserted++;
  }

  return NextResponse.json({
    ok: true,
    year,
    received: entries.length,
    upserted,
    unmatched_count: unmatched.length,
    unmatched,
  });
}
