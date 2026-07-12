import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Hikvision kamera push alıcısı — FAZ 1: keşif/log modu.
 *
 * Mağazadaki kişi sayım kamerası, "HTTP veri yükleme / bildirim sunucusu"
 * özelliğiyle sayım verisini periyodik olarak buraya POST'lar (kamera ağının
 * kendi interneti var; araya PC/köprü girmez). Gönderilen XML'in tam şeması
 * firmware'e göre değiştiği için ilk kurulumda ham gövde Vercel Logs'a
 * yazılır; gerçek format görüldüğünde parser + PeopleCountHour'a idempotent
 * yazım eklenecek (Faz 2).
 *
 * Kimlik: kamera Authorization başlığı gönderemez; URL'deki ?key= parametresi
 * HIKVISION_PUSH_KEY env değişkeniyle karşılaştırılır (INGEST_API_TOKEN'dan
 * bilinçli olarak ayrı — URL'ler log'lara düşer, ana token'ı kirletmesin).
 */

function keyOk(req: Request): boolean {
  const expected = (process.env.HIKVISION_PUSH_KEY || "").trim();
  const got = (new URL(req.url).searchParams.get("key") || "").trim();
  return Boolean(expected) && got === expected;
}

/** Kameranın "Test" butonu bazı firmware'lerde GET/HEAD atar. */
export async function GET(req: Request) {
  if (!keyOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, mode: "discovery" });
}

export async function POST(req: Request) {
  if (!keyOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const contentType = req.headers.get("content-type") || "";
  let body = "";
  try {
    body = (await req.text()).slice(0, 8000); // log taşmasın; keşif için yeterli
  } catch {
    body = "<gövde okunamadı>";
  }
  // Vercel Logs'tan izlenecek — kurulum günü format buradan çıkarılacak.
  console.log(
    "[hikvision-push]",
    JSON.stringify({ contentType, length: body.length, body })
  );
  return NextResponse.json({ ok: true, received: body.length });
}
