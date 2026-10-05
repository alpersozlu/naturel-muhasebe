import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { KolayikError, kolayikRead, type KolayikCall } from "@/server/services/kolayik/client";

/**
 * İMZALI, SALT OKUNUR Kolay İK denetim ucu.
 *
 * Kolay İK anahtarı yalnız Vercel ortamında durur (sahibi girdi; depoda ve
 * geliştirme makinesinde yoktur). İzin / mesai denetimi gibi işler için ham
 * kayıtlar buradan okunur. Kimlik, gönderilen gövdenin HMAC-SHA256 imzasıdır;
 * anahtar olarak sunucunun kendi SUPABASE_SERVICE_ROLE_KEY değeri kullanılır —
 * gizli değer HİÇBİR ZAMAN iletilmez, yalnız imza gider. İmza üretebilen,
 * zaten veritabanının tamamına erişebilen taraftır.
 *
 *   POST /api/jobs/kolayik
 *   x-signature: hex(hmac_sha256(SERVICE_ROLE_KEY, body))
 *   body: { "exp": <unix saniye, en çok 5 dk ileri>, "calls": [{ "path": "/v2/…", "method": "GET"|"POST", "query": {…}, "form": {…} }] }
 *
 * Yalnız liste / görüntüleme yolları çağrılabilir (client.ts → kolayikRead);
 * anahtarın Kolay İK'daki kapsamları da salt okunurdur. Yanıt önbelleğe alınmaz.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_CALLS = 80;
const MAX_AHEAD_S = 300;

type Call = KolayikCall & { path: string };

export async function POST(req: Request) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const body = await req.text();
  const given = Buffer.from(req.headers.get("x-signature") ?? "", "hex");
  const want = createHmac("sha256", key).update(body).digest();
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let parsed: { exp?: number; calls?: Call[] };
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof parsed.exp !== "number" || parsed.exp < now || parsed.exp > now + MAX_AHEAD_S) {
    return NextResponse.json({ error: "expired" }, { status: 401 });
  }
  const calls = Array.isArray(parsed.calls) ? parsed.calls.slice(0, MAX_CALLS) : [];

  // Sıra korunur; aynı anda en çok 5 çağrı (Kolay İK'yı yormamak için).
  const results: Array<{ ok: true; data: unknown } | { ok: false; status: number | null; error: string }> = new Array(calls.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= calls.length) return;
      const c = calls[i]!;
      try {
        results[i] = { ok: true, data: await kolayikRead(c.path, { method: c.method, query: c.query, form: c.form }) };
      } catch (e) {
        results[i] = { ok: false, status: e instanceof KolayikError ? e.status : null, error: e instanceof Error ? e.message : String(e) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, calls.length) }, worker));
  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
