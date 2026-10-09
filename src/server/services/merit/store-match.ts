/**
 * Mağaza tarafı doğrulama (Yükle ve Analiz Et › Otel Anlaşması): mağaza bir
 * personel kartı yükledikten sonra, NEBİM'de o adla kesilmiş fiş var mı; sahibi
 * yönetim notuna "%10 + otel" yazmış mı; fişte gerçekten EK %10 (dip iskonto)
 * uygulanmış mı? Köprü saatlik çalışır; satıştan hemen sonra "henüz fiş yok"
 * normaldir. Yönetim notunu sahibi sonradan işler — "onay bekliyor" da normaldir.
 */
import type { PrismaClient } from "@prisma/client";
import { nameSimilarity } from "./cards";
import { AUTO_MATCH_MIN, extraRateOf, hotelOf, isExtraOk, noteApproves } from "./check";

export type StoreMatchStatus = "confirmed" | "extra_mismatch" | "note_pending" | "not_found" | "unreadable";

export type StoreMatchInvoice = {
  invoice_ref: string;
  invoice_date: string;
  total: number;
  /** yönetim notu (sahibi yazar) */
  mgmt_note: string | null;
  hotel: string | null;
  /** yönetim notunda %10 + otel adı var */
  note_ok: boolean;
  /** ek indirim oranı (dip iskonto ÷ kampanya sonrası tutar), null = hesaplanamadı */
  extra_rate: number | null;
  extra_ok: boolean;
};

export type StoreMatch = {
  status: StoreMatchStatus;
  /** bu adla bulunan fişler (en yeni önce) */
  invoices: StoreMatchInvoice[];
  from: string;
  to: string;
};

/** Saf karar — test edilir. En iyi fiş: notu olan ve ek %10 tutan; yoksa notu olan; yoksa ilk. */
export function storeMatchStatus(invoices: StoreMatchInvoice[], readable: boolean): StoreMatchStatus {
  if (!readable) return "unreadable";
  if (invoices.length === 0) return "not_found";
  if (invoices.some((i) => i.note_ok && i.extra_ok)) return "confirmed";
  if (invoices.some((i) => i.note_ok || i.hotel)) return "extra_mismatch";
  return "note_pending";
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
    select: { invoice_ref: true, invoice_date: true, customer_name: true, qty: true, price: true, amount_vi: true, line_disc: true, doc_disc: true, mgmt_note: true, invoice_note: true, discount_reason: true, campaign: true },
  });
  const byRef = new Map<string, StoreMatchInvoice & { _base: number; _doc: number }>();
  for (const l of lines) {
    if (nameSimilarity(card.full_name, l.customer_name) < AUTO_MATCH_MIN) continue;
    let inv = byRef.get(l.invoice_ref);
    if (!inv) {
      const noteText = [l.mgmt_note, l.invoice_note, l.discount_reason, l.campaign].filter(Boolean).join(" | ");
      inv = {
        invoice_ref: l.invoice_ref,
        invoice_date: iso(l.invoice_date),
        total: 0,
        mgmt_note: l.mgmt_note?.replace(/\s+/g, " ").trim().slice(0, 120) ?? null,
        hotel: hotelOf(noteText),
        note_ok: noteApproves(l.mgmt_note),
        extra_rate: null,
        extra_ok: false,
        _base: 0,
        _doc: 0,
      };
      byRef.set(l.invoice_ref, inv);
    }
    inv.total = Math.round((inv.total + Number(l.amount_vi ?? 0)) * 100) / 100;
    inv._base += Number(l.price ?? 0) * Number(l.qty ?? 0) - Number(l.line_disc ?? 0);
    inv._doc += Number(l.doc_disc ?? 0);
  }
  const invoices: StoreMatchInvoice[] = Array.from(byRef.values())
    .map(({ _base, _doc, ...rest }) => {
      const extra_rate = extraRateOf(_base, _doc);
      return { ...rest, extra_rate, extra_ok: isExtraOk(extra_rate) };
    })
    .sort((a, b) => b.invoice_date.localeCompare(a.invoice_date));
  return { status: storeMatchStatus(invoices, true), invoices, from: iso(from), to: iso(to) };
}
