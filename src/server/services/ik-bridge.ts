import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * NATUREL İK KÖPRÜSÜ (Muhasebe tarafı). İK ayrı bir program (ayrı veritabanı,
 * ayrı giriş); iki program yalnız bu imzalı köprüyle konuşur. Anahtar iki
 * tarafta aynı ortam değişkeni BRIDGE_SECRET — kendisi hiç iletilmez, yalnız
 * gövdenin HMAC-SHA256 imzası gider; gövdedeki `exp` en çok 5 dk ileri.
 *
 *   İK → Muhasebe  /api/bridge/ik        snapshot · finance · terminate
 *   Muhasebe → İK  {IK_URL}/api/bridge/muhasebe   payroll_month (Maaşlar önerisi)
 */
const MAX_AHEAD_S = 300;

export function ikSign(body: string, secret = process.env.BRIDGE_SECRET ?? ""): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function ikVerify(body: string, signature: string | null): { ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string } {
  const secret = process.env.BRIDGE_SECRET;
  if (!secret) return { ok: false, status: 503, error: "not configured" };
  const given = Buffer.from(signature ?? "", "hex");
  const want = Buffer.from(ikSign(body, secret), "hex");
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { ok: false, status: 401, error: "unauthorized" };
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body);
  } catch {
    return { ok: false, status: 400, error: "bad body" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof data.exp !== "number" || data.exp < now || data.exp > now + MAX_AHEAD_S) return { ok: false, status: 401, error: "expired" };
  return { ok: true, data };
}

export type IkPayrollRow = {
  employeeId: string;
  /** Onaylı hafta içi mesai */
  overtimeMinutes: number;
  /** Onaylı pazar / bayram mesaisi (Derimod; ödemede ×restDayMultiplier) */
  restDayOvertimeMinutes: number;
  /** Henüz onaylanmamış mesai (bilgi) */
  waitingMinutes: number;
  unpaidDays: number;
  workedRestDays: number;
};

/**
 * Kalem kalem İK kararları (kimlikle): devamsızlık kesintisi ve nakde çevrilen
 * izin. Maaşlar her kalemi bir kez aktarır (PayrollEntry.reference =
 * "naturel-ik:<id>"); İK'da geri alınan kalem status "cancelled" gelir.
 */
export type IkPayrollItem = {
  id: string;
  type: "absence_deduction" | "leave_payout";
  employeeId: string;
  status: "active" | "cancelled";
  days: number;
  amount: number;
  start: string;
  end: string;
  reason: string;
  detail: string;
  note: string | null;
};

/** Ayın onaylı mesaisi / ücretsiz izinleri — Maaşlar ekranında öneri olarak (Kolay İK okumasının yerine). */
export async function fetchIkPayrollMonth(year: number, month: number): Promise<{ restDayMultiplier: number; rows: IkPayrollRow[]; items?: IkPayrollItem[] }> {
  const url = process.env.IK_URL;
  if (!url || !process.env.BRIDGE_SECRET) throw new Error("İK köprüsü ayarlı değil (IK_URL / BRIDGE_SECRET).");
  const body = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 120, op: "payroll_month", year, month });
  const res = await fetch(`${url}/api/bridge/muhasebe`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": ikSign(body) },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`İK köprüsü HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}
