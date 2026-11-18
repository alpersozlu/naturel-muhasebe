import type { PrismaClient } from "@prisma/client";

/**
 * HEDİYE ÇEKİ ↔ MAĞAZA ÖZETİ MUTABAKATI (sahibi, 17.11.2026).
 *
 * "Derimodların mağaza özetinde Derimod Hediye Çeki diye ne kadar kullandıysa
 * belirtiyor ama o BARKODLU olanları söyleyebiliyor; en azından barkodlu gelen
 * hediye çeklerinin sisteme işlendiğinin kontrolü yapılması gerek — özetteki
 * hediye çeki ile birebir örtüşürse tamamdır."
 *
 * Nebim özeti kasadan geçen çeki yazar; biz de okutulan çekleri toplarız. İki
 * rakam birebir tutuyorsa o günün barkodlu çeklerinin hepsi sisteme girilmiş
 * demektir. Tutmuyorsa eksik (ya da fazladan) okutma vardır.
 *
 * BARKODSUZ eski çekler bu denetimin dışındadır: Nebim onları da kasada
 * gösterebilir ama barkodsuz okutmada tutar elle girildiği için fark çıkması
 * her zaman hata anlamına gelmez — bu yüzden sonuç uyarıdır, kilit engeli değil.
 */

export type GiftVoucherMatchState =
  /** Özetteki tutar okutulan çeklerle birebir aynı. */
  | "match"
  /** Özet daha fazla gösteriyor: okutulmamış çek var. */
  | "missing"
  /** Okutulan çekler özetten fazla: fazladan ya da yanlış güne okutulmuş. */
  | "extra"
  /** Özette Hediye Çeki satırı yok (o gün çek kullanılmamış). */
  | "no_row"
  /** Gün için mağaza özeti henüz yüklenmemiş. */
  | "no_summary"
  /** Özet, bu alan okunmaya başlamadan önce analiz edilmiş. */
  | "unread";

export type GiftVoucherMatch = {
  /** Sisteme okutulan çeklerin toplamı (aralık birleşikse tüm günler). */
  scanned_total: number;
  scanned_count: number;
  /** Mağaza özetindeki "Hediye Çeki" tutarı; okunamadıysa null. */
  summary_total: number | null;
  /** summary_total − scanned_total */
  diff: number;
  state: GiftVoucherMatchState;
  /** Özetin kapsadığı aralık (birleşik günlerde birden çok gün). */
  from: string;
  to: string;
  merged: boolean;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const num = (d: { toNumber(): number } | null | undefined) => d?.toNumber() ?? 0;
/** Kuruş kuruşuna karşılaştırma; kayan nokta gürültüsü dışarıda. */
const EPS = 0.005;

type SummaryHit = {
  parsed: Record<string, unknown> | null;
  period_start: Date | null;
  period_end: Date | null;
};

/**
 * Günü kapsayan mağaza özeti. Birleşik günlerde özet grubun tek bir gününe
 * bağlıdır ama period_start–period_end tüm grubu kapsar, bu yüzden önce günün
 * kendi özetine, sonra aralığı bu günü içeren özete bakılır.
 */
async function findSummary(prisma: PrismaClient, storeId: string, dateIso: string): Promise<SummaryHit | null> {
  const d = day(dateIso);
  const include = { upload: { select: { parsed_data_json: true } } } as const;
  const own = await prisma.storeSummary.findFirst({
    where: { daily_record: { store_id: storeId, date: d } },
    include,
  });
  const hit =
    own ??
    (await prisma.storeSummary.findFirst({
      where: { daily_record: { store_id: storeId }, period_start: { lte: d }, period_end: { gte: d } },
      include,
    }));
  if (!hit) return null;
  const parsed = hit.upload?.parsed_data_json;
  return {
    parsed: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null,
    period_start: hit.period_start,
    period_end: hit.period_end,
  };
}

/** Özetin parsed_data_json'undan "Hediye Çeki" tutarı. */
function readUsed(parsed: Record<string, unknown> | null): { present: boolean; value: number | null } {
  // Alan hiç yoksa özet bu denetimden ÖNCE analiz edilmiştir — "satır yok" ile
  // karıştırılmaz, yoksa eski günlerin hepsi yanlış alarm verir.
  if (!parsed || !("gift_voucher_used" in parsed)) return { present: false, value: null };
  const raw = parsed.gift_voucher_used;
  return { present: true, value: typeof raw === "number" ? Math.round(Math.abs(raw) * 100) / 100 : null };
}

/** Okutulan toplam ile özetteki tutarın kararı — tek gün de, denetim listesi de buradan geçer. */
function decide(
  used: { present: boolean; value: number | null },
  scanned: number
): { summary_total: number | null; diff: number; state: GiftVoucherMatchState } {
  if (!used.present) return { summary_total: null, diff: 0, state: "unread" };
  // Satır yok + okutulmuş çek de yok → o gün çek kullanılmamış, denetlenecek
  // bir şey yok. Satır yok ama çek okutulmuşsa bu da bir uyuşmazlıktır
  // (yanlış güne / yanlış mağazaya okutulmuş olabilir) — 0 ile karşılaştırılır.
  // "Satır yok" 0 ile gelir (16 birleşik alan sınırı — şemadaki nota bak); eski
  // kayıtlarda null olabilir. İkisi de aynı anlama gelir.
  if (used.value == null || used.value <= EPS) {
    if (scanned <= EPS) return { summary_total: null, diff: 0, state: "no_row" };
    return { summary_total: 0, diff: -scanned, state: "extra" };
  }
  const diff = Math.round((used.value - scanned) * 100) / 100;
  return { summary_total: used.value, diff, state: Math.abs(diff) <= EPS ? "match" : diff > 0 ? "missing" : "extra" };
}

export async function giftVoucherSummaryMatch(
  prisma: PrismaClient,
  storeId: string,
  dateIso: string
): Promise<GiftVoucherMatch> {
  const summary = await findSummary(prisma, storeId, dateIso);
  const from = summary?.period_start ? iso(summary.period_start) : dateIso;
  const to = summary?.period_end ? iso(summary.period_end) : dateIso;

  const g = await prisma.giftVoucherClaim.aggregate({
    where: { used_store_id: storeId, used_date: { gte: day(from), lte: day(to) } },
    _sum: { amount: true },
    _count: true,
  });
  const scanned_total = Math.round(num(g._sum.amount) * 100) / 100;
  const base = { scanned_total, scanned_count: g._count, from, to, merged: from !== to };

  if (!summary) return { ...base, summary_total: null, diff: 0, state: "no_summary" };
  return { ...base, ...decide(readUsed(summary.parsed), scanned_total) };
}

// ── Günler arası denetim listesi ────────────────────────────────────────────

export type GiftVoucherAuditRow = GiftVoucherMatch & { store_id: string; store_name: string };

export type GiftVoucherAudit = {
  /** Yalnız sorunlu satırlar: eksik / fazla okutma, özeti olmayan çek günü. */
  rows: GiftVoucherAuditRow[];
  /** Karşılaştırılabilen özet sayısı (match + missing + extra + no_row). */
  checked: number;
  matched: number;
  /** Alanı taşımayan eski özetler — yeniden analiz edilmedikçe karşılaştırılamaz. */
  unread: number;
  from: string;
  to: string;
};

/**
 * Bir tarih aralığındaki bütün Derimod günlerini tarar ve özetle okutulan
 * çeklerin tutmadığı günleri döner (sahibi, 17.11.2026). Gün gün karta bakmak
 * yerine "hangi günlerde tutmuyor" tek listede görünsün diye.
 */
export async function giftVoucherAudit(
  prisma: PrismaClient,
  range: { from: string; to: string }
): Promise<GiftVoucherAudit> {
  const stores = await prisma.store.findMany({
    where: { deleted_at: null, brand: { name: { contains: "derimod", mode: "insensitive" } } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(stores.map((s) => [s.id, s.name]));
  const ids = stores.map((s) => s.id);
  const empty = { rows: [], checked: 0, matched: 0, unread: 0, ...range };
  if (ids.length === 0) return empty;

  const summaries = await prisma.storeSummary.findMany({
    where: { daily_record: { store_id: { in: ids }, date: { gte: day(range.from), lte: day(range.to) } } },
    include: {
      upload: { select: { parsed_data_json: true } },
      daily_record: { select: { date: true, store_id: true } },
    },
  });

  // Birleşik özet aralığı taradığımız pencerenin dışına taşabilir — çekleri
  // kapsayan en geniş aralıkla çekip bellekte eşleştiririz.
  let lo = range.from;
  let hi = range.to;
  for (const s of summaries) {
    if (s.period_start && iso(s.period_start) < lo) lo = iso(s.period_start);
    if (s.period_end && iso(s.period_end) > hi) hi = iso(s.period_end);
  }
  const claims = await prisma.giftVoucherClaim.findMany({
    where: { used_store_id: { in: ids }, used_date: { gte: day(lo), lte: day(hi) } },
    select: { used_store_id: true, used_date: true, amount: true },
  });
  const byDay = new Map<string, { total: number; count: number }>();
  for (const c of claims) {
    if (!c.used_store_id || !c.used_date) continue;
    const k = `${c.used_store_id}|${iso(c.used_date)}`;
    const cur = byDay.get(k) ?? { total: 0, count: 0 };
    byDay.set(k, { total: cur.total + num(c.amount), count: cur.count + 1 });
  }

  const days = (from: string, to: string) => {
    const out: string[] = [];
    for (let d = day(from); iso(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(iso(d));
    return out;
  };

  const covered = new Set<string>();
  const rows: GiftVoucherAuditRow[] = [];
  let checked = 0;
  let matched = 0;
  let unread = 0;

  for (const s of summaries) {
    const storeId = s.daily_record.store_id;
    const from = iso(s.period_start ?? s.daily_record.date);
    const to = iso(s.period_end ?? s.daily_record.date);
    let total = 0;
    let count = 0;
    for (const d of days(from, to)) {
      covered.add(`${storeId}|${d}`);
      const hit = byDay.get(`${storeId}|${d}`);
      if (hit) {
        total += hit.total;
        count += hit.count;
      }
    }
    const scanned_total = Math.round(total * 100) / 100;
    const parsed = s.upload?.parsed_data_json;
    const used = readUsed(
      parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
    );
    const d = decide(used, scanned_total);
    if (d.state === "unread") unread++;
    else {
      checked++;
      if (d.state === "match" || d.state === "no_row") matched++;
    }
    if (d.state === "missing" || d.state === "extra")
      rows.push({
        store_id: storeId,
        store_name: nameOf.get(storeId) ?? "—",
        scanned_total,
        scanned_count: count,
        from,
        to,
        merged: from !== to,
        ...d,
      });
  }

  // Çek okutulmuş ama o gün için hiç özet yok → denetlenemiyor, ayrıca uyarılır.
  for (const [k, v] of Array.from(byDay.entries())) {
    if (covered.has(k)) continue;
    const [storeId, date] = k.split("|") as [string, string];
    if (date < range.from || date > range.to) continue;
    if (v.total <= EPS) continue;
    rows.push({
      store_id: storeId,
      store_name: nameOf.get(storeId) ?? "—",
      scanned_total: Math.round(v.total * 100) / 100,
      scanned_count: v.count,
      summary_total: null,
      diff: 0,
      state: "no_summary",
      from: date,
      to: date,
      merged: false,
    });
  }

  rows.sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : a.store_name.localeCompare(b.store_name, "tr")));
  return { rows, checked, matched, unread, ...range };
}
