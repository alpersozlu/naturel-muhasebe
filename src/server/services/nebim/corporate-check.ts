/**
 * Derimod kurumsal / yönetim alışverişi ↔ NEBİM fişi kontrolü (sahibi, 17.10.2026:
 * "Derimod'un kurumsal alışverişlerinde fiş istemiyor sistem ama Nebim'den
 * kontrolü sağlaması gerek").
 *
 * Mavi'de kurumsal alışverişin bilgi fişi yüklenir; Derimod'da satış zaten
 * NEBİM'den köprüyle gelir, fotoğraf istenmez. Burada elle girilen tutar, o
 * gün (±1 gün, köprü gece yarısı kayması) o mağazada aynı kişiye/şirkete
 * kesilen fişlerin NET toplamıyla (matrah + KDV = fiilen ödenen) karşılaştırılır.
 * Ölçüldü 15.10.2026 Lefkoşa: Mert Ersözlü 36.500 = 1-R-7-94725 (26.000) +
 * 1-R-7-94730 (10.500); 12.10 Mine Ersözlü 12.692 = 1-R-7-94587 (12.691,98).
 */
import type { PrismaClient } from "@prisma/client";
import { nameSimilarity } from "@/server/services/merit/cards";

export type CorporateNebimStatus = "match" | "amount_mismatch" | "not_found";
export type CorporateNebimCheck = {
  status: CorporateNebimStatus;
  /** eşleşen / isme uyan fişler */
  invoice_refs: string[];
  customer_name: string | null;
  /** o kişinin fişlerinin net toplamı (matrah + KDV) */
  nebim_net: number | null;
  /** bu tutarda isimsiz tek fiş bulunduysa (isim tutmadı ama tutar birebir) */
  amount_only_ref: string | null;
};

export type NebimInvoiceNet = { invoice_ref: string; customer_name: string | null; net: number; date: string };

const r2 = (v: number) => Math.round(v * 100) / 100;
const TOL = 1; // ₺ — kuruş yuvarlaması (12.691,98 ↔ 12.692)

/** Saf eşleştirme — test edilir. */
export function matchCorporateToInvoices(
  purchase: { person_name: string; company_name: string | null; amount_try: number },
  invoices: NebimInvoiceNet[]
): CorporateNebimCheck {
  const names = [purchase.person_name, purchase.company_name].filter((n): n is string => !!n && n.trim().length > 1);
  const byName = invoices.filter((i) => names.some((n) => nameSimilarity(n, i.customer_name) >= 0.8));
  if (byName.length > 0) {
    const customer = byName[0]!.customer_name;
    const total = r2(byName.reduce((s, i) => s + i.net, 0));
    // tam toplam ya da fişlerin bir alt kümesi tutuyorsa (küçük sayılar: 2^n deneme, n ≤ 8)
    const subset = findSubset(byName, purchase.amount_try);
    if (Math.abs(total - purchase.amount_try) <= TOL) return { status: "match", invoice_refs: byName.map((i) => i.invoice_ref), customer_name: customer, nebim_net: total, amount_only_ref: null };
    if (subset) return { status: "match", invoice_refs: subset.map((i) => i.invoice_ref), customer_name: customer, nebim_net: r2(subset.reduce((s, i) => s + i.net, 0)), amount_only_ref: null };
    return { status: "amount_mismatch", invoice_refs: byName.map((i) => i.invoice_ref), customer_name: customer, nebim_net: total, amount_only_ref: null };
  }
  const amountOnly = invoices.find((i) => Math.abs(i.net - purchase.amount_try) <= TOL);
  return { status: "not_found", invoice_refs: [], customer_name: null, nebim_net: null, amount_only_ref: amountOnly?.invoice_ref ?? null };
}

function findSubset(items: NebimInvoiceNet[], target: number): NebimInvoiceNet[] | null {
  const n = Math.min(items.length, 8);
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0;
    const pick: NebimInvoiceNet[] = [];
    for (let b = 0; b < n; b++) if (mask & (1 << b)) { sum += items[b]!.net; pick.push(items[b]!); }
    if (Math.abs(r2(sum) - target) <= TOL) return pick;
  }
  return null;
}

/** Mağazanın ±1 günlük fişleri (iadesiz), fiş başına net. */
export async function loadInvoiceNets(prisma: PrismaClient, storeId: string, day: Date): Promise<NebimInvoiceNet[]> {
  const from = new Date(day.getTime() - 86_400_000);
  const to = new Date(day.getTime() + 86_400_000);
  const lines = await prisma.nebimSaleLine.findMany({
    where: { store_id: storeId, is_return: false, invoice_date: { gte: from, lte: to } },
    select: { invoice_ref: true, invoice_date: true, customer_name: true, tax_base: true, vat: true },
  });
  const m = new Map<string, NebimInvoiceNet>();
  for (const l of lines) {
    const cur = m.get(l.invoice_ref) ?? { invoice_ref: l.invoice_ref, customer_name: l.customer_name, net: 0, date: l.invoice_date.toISOString().slice(0, 10) };
    cur.net = r2(cur.net + Number(l.tax_base ?? 0) + Number(l.vat ?? 0));
    m.set(l.invoice_ref, cur);
  }
  return Array.from(m.values());
}
