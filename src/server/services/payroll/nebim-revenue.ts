import "server-only";
import type { PrismaClient } from "@prisma/client";
import { prisma as scopedPrisma } from "@/lib/prisma";

/**
 * Derimod cirosu — DocuFlow'daki Nebim satış satırlarından, KDV HARİÇ
 * (tax_base), iadeler eksi işaretli olduğu için toplam = net ciro.
 * Askıdaki (is_completed=false) satırlar scoped prisma ile zaten dışarıda.
 *
 * Ağustos 2026 doğrulaması: master dosyadaki SAP rakamlarıyla mağaza ve
 * kişi bazında %0,0–0,19 içinde tuttu (devir okuması, 30.09.2026).
 */
export type NebimMonthRevenue = {
  by_store: Map<string, number>; // store_id → net
  by_person: Map<string, number>; // `${store_id}|${salesperson_name}` → net
  names_by_store: Map<string, string[]>; // store_id → satıcı adları (eşleme yardımı)
};

export async function derimodMonthRevenue(
  prisma: PrismaClient | typeof scopedPrisma,
  year: number,
  month: number
): Promise<NebimMonthRevenue> {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const rows = await prisma.nebimSaleLine.groupBy({
    by: ["store_id", "salesperson_name"],
    where: { invoice_date: { gte: from, lt: to }, store_id: { not: null } },
    _sum: { tax_base: true },
  });
  const by_store = new Map<string, number>();
  const by_person = new Map<string, number>();
  const names_by_store = new Map<string, string[]>();
  for (const r of rows) {
    const sid = r.store_id!;
    const net = Number(r._sum.tax_base ?? 0);
    by_store.set(sid, (by_store.get(sid) ?? 0) + net);
    const name = (r.salesperson_name ?? "").trim();
    if (name) {
      by_person.set(`${sid}|${normalizeName(name)}`, (by_person.get(`${sid}|${normalizeName(name)}`) ?? 0) + net);
      const list = names_by_store.get(sid) ?? [];
      if (!list.includes(name)) list.push(name);
      names_by_store.set(sid, list);
    }
  }
  return { by_store, by_person, names_by_store };
}

/** "DÖNE Casun" ≈ "Döne Konmaz"? Hayır — ama "Kaan Kılıç" ≈ "KAAN KILIÇ": harf/aksan/boşluk duyarsız. */
export function normalizeName(s: string): string {
  return s
    .toLocaleLowerCase("tr")
    .replace(/[İı]/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Çalışanın Nebim satıcı cirosu: nebim_name, tam ad ve takma adlarla dener. */
export function personRevenueFor(
  rev: NebimMonthRevenue,
  storeId: string,
  candidates: Array<string | null | undefined>
): number | null {
  for (const c of candidates) {
    if (!c) continue;
    const v = rev.by_person.get(`${storeId}|${normalizeName(c)}`);
    if (v != null) return v;
  }
  return null;
}
