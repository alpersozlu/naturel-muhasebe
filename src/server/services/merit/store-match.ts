/**
 * Mağaza tarafı doğrulama (Yükle ve Analiz Et › Otel Anlaşması): mağaza bir
 * personel kartı yükledikten sonra, NEBİM'de o adla kesilmiş fiş var mı ve o
 * fişte otel (%10) notu yazılmış mı? Köprü saatlik çalışır; satıştan hemen
 * sonra "henüz fiş yok" normaldir.
 */
import type { PrismaClient } from "@prisma/client";
import { nameSimilarity } from "./cards";
import { AUTO_MATCH_MIN, hotelOf } from "./check";

export type StoreMatchStatus = "confirmed" | "no_hotel_note" | "not_found" | "unreadable";

export type StoreMatch = {
  status: StoreMatchStatus;
  /** bu adla bulunan fişler (en yeni önce) */
  invoices: Array<{ invoice_ref: string; invoice_date: string; total: number; discount_pct: number | null; hotel: string | null; note: string | null }>;
  /** aranan tarih penceresi */
  from: string;
  to: string;
};

/** Saf karar — test edilir. */
export function storeMatchStatus(invoices: StoreMatch["invoices"], readable: boolean): StoreMatchStatus {
  if (!readable) return "unreadable";
  if (invoices.length === 0) return "not_found";
  return invoices.some((i) => i.hotel) ? "confirmed" : "no_hotel_note";
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function matchCardToSales(
  prisma: PrismaClient,
  card: { full_name: string | null; is_card: boolean; ocr_status: string; store_id: string | null; photo_date: Date | null; uploaded_at: Date }
): Promise<StoreMatch> {
  // pencere: çekim gününden 3 gün önce → bugün (çekim günü yoksa yükleme gününden 14 gün geri)
  const anchor = card.photo_date ?? new Date(card.uploaded_at.getTime() - 14 * DAY);
  const from = new Date(anchor.getTime() - 3 * DAY);
  const to = new Date();
  const readable = card.is_card && card.ocr_status === "done" && !!card.full_name;
  if (!readable || !card.store_id) return { status: readable ? "not_found" : "unreadable", invoices: [], from: iso(from), to: iso(to) };

  const lines = await prisma.nebimSaleLine.findMany({
    where: { store_id: card.store_id, is_return: false, invoice_date: { gte: new Date(`${iso(from)}T00:00:00.000Z`), lte: new Date(`${iso(to)}T00:00:00.000Z`) }, customer_name: { not: null } },
    select: { invoice_ref: true, invoice_date: true, customer_name: true, amount_vi: true, discount_pct: true, mgmt_note: true, invoice_note: true, discount_reason: true, campaign: true },
  });
  const byRef = new Map<string, StoreMatch["invoices"][number]>();
  for (const l of lines) {
    if (nameSimilarity(card.full_name, l.customer_name) < AUTO_MATCH_MIN) continue;
    let inv = byRef.get(l.invoice_ref);
    if (!inv) {
      const noteText = [l.mgmt_note, l.invoice_note, l.discount_reason, l.campaign].filter(Boolean).join(" | ");
      inv = {
        invoice_ref: l.invoice_ref,
        invoice_date: iso(l.invoice_date),
        total: 0,
        discount_pct: l.discount_pct == null ? null : Number(l.discount_pct),
        hotel: hotelOf(noteText),
        note: (l.mgmt_note ?? l.invoice_note ?? null)?.replace(/\s+/g, " ").trim().slice(0, 120) ?? null,
      };
      byRef.set(l.invoice_ref, inv);
    }
    inv.total = Math.round((inv.total + Number(l.amount_vi ?? 0)) * 100) / 100;
  }
  const invoices = Array.from(byRef.values()).sort((a, b) => b.invoice_date.localeCompare(a.invoice_date));
  return { status: storeMatchStatus(invoices, true), invoices, from: iso(from), to: iso(to) };
}
