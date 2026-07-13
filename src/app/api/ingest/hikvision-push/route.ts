import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Hikvision kamera push alıcısı — FAZ 2: canlı işleyici.
 *
 * Mağazadaki kişi sayım kameraları her dakika bir EventNotificationAlert
 * (PSIA XML) basar: <peopleCounting> içinde o dakikanın giren/çıkanı +
 * TimeRange. Zincir: kamera → kisi-sayim-relay (Cloudflare, HTTP→HTTPS) →
 * burası. Kamera MAC'i kapıyı tanımlar; dakika kaydı (camera_mac, start)
 * üzerinden idempotent yazılır, ardından o saatin PeopleCountHour satırı
 * dakikaların kameralar-arası toplamı olarak yeniden hesaplanır.
 *
 * Saat/tarih kameranın YEREL zaman bileşenlerinden alınır, ofset yok sayılır
 * (kameranın TZ etiketi yanlış ama duvar saati doğru; arama API'siyle ve
 * panelle aynı konvansiyon).
 *
 * Kimlik: ?key= = HIKVISION_PUSH_KEY (relay bunu gizli tutar; kamera yalnız
 * relay'in yol token'ını bilir).
 */

/** Kamera MAC → mağaza eşlemesi (Derimod Lefkoşa: iki giriş kapısı). */
const CAMERAS: Record<string, { store_code: string; label: string }> = {
  "bc:9b:5e:e4:11:72": { store_code: "S01", label: "Lefkosa Kapi 2" },
  "bc:9b:5e:e4:11:70": { store_code: "S01", label: "Lefkosa Kapi 1" },
};

function keyOk(req: Request): boolean {
  const expected = (process.env.HIKVISION_PUSH_KEY || "").trim();
  const got = (new URL(req.url).searchParams.get("key") || "").trim();
  return Boolean(expected) && got === expected;
}

/** İlk eşleşen tag içeriği (regex; şema sabit, XML bağımlılığına gerek yok). */
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1]!.trim() : null;
}

export async function GET(req: Request) {
  if (!keyOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, mode: "live" });
}

export async function POST(req: Request) {
  if (!keyOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body = "";
  try {
    body = (await req.text()).slice(0, 16000);
  } catch {
    return NextResponse.json({ ok: false, error: "unreadable_body" }, { status: 400 });
  }

  // Yalnız peopleCounting olaylarını işle; gerisini (heartbeat vb.) logla-geç.
  const eventType = tag(body, "eventType") || "";
  if (eventType.toLowerCase() !== "peoplecounting") {
    console.log("[hikvision-push] atlandı, eventType:", eventType || "(yok)");
    return NextResponse.json({ ok: true, skipped: eventType || "unknown" });
  }

  const mac = (tag(body, "macAddress") || "").toLowerCase();
  const cam = CAMERAS[mac];
  // childCounting bloğunu at, ana peopleCounting sayılarının yanlış
  // eşleşmesini önle (ikisi de <enter>/<exit> kullanıyor).
  const pcBlock = body.match(/<peopleCounting>[\s\S]*?<\/peopleCounting>/)?.[0] ?? "";
  const start = tag(pcBlock, "startTime") || tag(body, "dateTime") || "";
  const enter = Number(tag(pcBlock, "enter"));
  const exit = Number(tag(pcBlock, "exit"));

  if (!cam || start.length < 16 || !Number.isFinite(enter) || !Number.isFinite(exit)) {
    // Keşif tuzağı: yeni kaynak (örn. NVR) farklı formatta gönderiyorsa ham
    // gövdeyi sakla — parser buradan okunarak uyarlanır. 7 günden eskiyi temizle.
    await prisma.peopleCountRawPush.create({ data: { body: body.slice(0, 4000) } });
    await prisma.peopleCountRawPush.deleteMany({
      where: { created_at: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
    });
    console.log("[hikvision-push] çözümlenemedi, ham kayıt alındı:", JSON.stringify({ mac, start }));
    return NextResponse.json({ ok: true, unparsed: true });
  }

  const minuteKey = start.slice(0, 16); // YYYY-MM-DDTHH:MM (yerel, ofsetsiz)
  const date = minuteKey.slice(0, 10);
  const hour = Number(minuteKey.slice(11, 13));

  await prisma.peopleCountMinute.upsert({
    where: { camera_mac_start: { camera_mac: mac, start: minuteKey } },
    create: {
      camera_mac: mac,
      store_code: cam.store_code,
      start: minuteKey,
      enter: Math.min(enter, 100000),
      exit: Math.min(exit, 100000),
    },
    update: { enter: Math.min(enter, 100000), exit: Math.min(exit, 100000) },
  });

  // Saatlik satırı dakikaların toplamından yeniden kur (tüm kapılar dahil).
  const agg = await prisma.peopleCountMinute.aggregate({
    where: {
      store_code: cam.store_code,
      start: { gte: `${date}T${minuteKey.slice(11, 13)}:00`, lte: `${date}T${minuteKey.slice(11, 13)}:59` },
    },
    _sum: { enter: true, exit: true },
  });
  const data = {
    enter: agg._sum.enter ?? 0,
    exit: agg._sum.exit ?? 0,
    source: "hikvision-push",
  };
  await prisma.peopleCountHour.upsert({
    where: { store_code_date_hour: { store_code: cam.store_code, date, hour } },
    create: { store_code: cam.store_code, date, hour, ...data },
    update: data,
  });

  return NextResponse.json({ ok: true, store: cam.store_code, minute: minuteKey, enter, exit });
}
