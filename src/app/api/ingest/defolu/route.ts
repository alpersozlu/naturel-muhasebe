import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { defoluIngestSchema } from "@/lib/zod-schemas/defolu-ingest";
import {
  ALL_STORE_CODES,
  brandCodeFromName,
  getMasrafBrand,
  MASRAF_BRAND_KEYS,
} from "@/lib/masraf/brands";

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

/** Bir adı tüm markalarda sırayla (Mavi öncelik) koda çözer. */
function codeFromName(name: string | undefined): string | null {
  if (!name) return null;
  for (const k of MASRAF_BRAND_KEYS) {
    const c = brandCodeFromName(getMasrafBrand(k), name);
    if (c) return c;
  }
  return null;
}

/** Bir satırı mağaza koduna çözer (geçerli kod öncelikli, sonra ad eşleştirme). */
function resolveStoreCode(e: {
  store_code?: string;
  store_name?: string;
}): string | null {
  // store_code zaten geçerli bir marka kodu mu? (9400-9403 / S01-S03)
  if (e.store_code && ALL_STORE_CODES[e.store_code]) return e.store_code;
  // ad eşleştirme (store_name; sonra store_code bir ad olabilir)
  return codeFromName(e.store_name) ?? codeFromName(e.store_code);
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
    const code = resolveStoreCode(e);
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
