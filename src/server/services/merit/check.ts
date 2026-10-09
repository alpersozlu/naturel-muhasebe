/**
 * "Merit %10 Kontrolü" — Derimod'da anlaşmalı otel (Merit) çalışanına yapılan
 * %10 sepet indirimi gerçekten otel personeline mi yapıldı?
 *
 * Kaynak: NEBİM fişleri (NebimSaleLine). Merit indirimi fişte yönetim notu /
 * fiş notu / iskonto nedeni / kampanya alanlarından birinde "merit" geçmesiyle
 * tanınır ("%10 Merit", "MERİT PERSONELİ", "merit personeli %10 indirim…").
 * Fişteki müşteri adı, mağazanın çektiği personel kartı fotoğrafıyla (MeritCard,
 * OCR'dan ad) eşleştirilir.
 *
 * Kart zorunluluğu (sahibi, 09.10.2026): Girne'de baştan beri; Lefkoşa'da
 * 08.10.2026'dan itibaren. Daha eski Lefkoşa fişleri "kural öncesi" sayılır,
 * kırmızı değildir. Mağusa programda değil.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { createSignedReadUrl } from "@/server/services/storage";
import { nameSimilarity } from "./cards";

/** NEBİM mağaza kodu → kartın zorunlu olduğu ilk gün */
export const MERIT_RULE_START: Record<string, string> = {
  S03: "2026-01-01", // Derimod Girne — baştan beri
  S01: "2026-10-08", // Derimod Lefkoşa — 08.10.2026'dan itibaren
};
export const AUTO_MATCH_MIN = 0.8;
export const SUGGEST_MIN = 0.4;

export type MeritStatus = "ok_card" | "ok_no_card" | "missing" | "not_required" | "rejected";

export function meritRuleApplies(storeCode: string | null, dateIso: string): boolean {
  const start = storeCode ? MERIT_RULE_START[storeCode] : undefined;
  return !!start && dateIso >= start;
}

/** Durum kararı — saf; test edilir. */
export function meritStatus(input: {
  decision: "card" | "no_card_ok" | "rejected" | null;
  autoScore: number;
  required: boolean;
}): MeritStatus {
  if (input.decision === "card") return "ok_card";
  if (input.decision === "no_card_ok") return "ok_no_card";
  if (input.decision === "rejected") return "rejected";
  if (input.autoScore >= AUTO_MATCH_MIN) return "ok_card";
  return input.required ? "missing" : "not_required";
}

export const MERIT_LINE_WHERE: Prisma.NebimSaleLineWhereInput = {
  is_return: false,
  OR: [
    { mgmt_note: { contains: "merit", mode: "insensitive" } },
    { invoice_note: { contains: "merit", mode: "insensitive" } },
    { discount_reason: { contains: "merit", mode: "insensitive" } },
    { campaign: { contains: "merit", mode: "insensitive" } },
  ],
};

export type MeritCardView = {
  id: string;
  full_name: string | null;
  id_no: string | null;
  company: string | null;
  department: string | null;
  photo_date: string | null;
  source_name: string | null;
  ocr_status: string;
  is_card: boolean;
  ocr_error: string | null;
  note: string | null;
  uploaded_at: string;
  url: string | null;
  /** bu karta bağlı (elle ya da otomatik) fiş sayısı */
  linked: number;
};

export type MeritInvoiceView = {
  invoice_ref: string;
  invoice_date: string;
  store_id: string | null;
  store_name: string;
  store_code: string | null;
  customer_name: string | null;
  salesperson_name: string | null;
  lines: number;
  units: number;
  total: number; // Σ Tutar (KDV dahil, satılan)
  discount: number; // Σ satır + dip iskonto
  note: string | null; // merit geçen not (yönetim / fiş)
  required: boolean;
  status: MeritStatus;
  match: "manual" | "auto" | null;
  card: { id: string; full_name: string | null; id_no: string | null; company: string | null; url: string | null; score: number | null } | null;
  suggestions: Array<{ id: string; full_name: string | null; id_no: string | null; score: number }>;
  review_note: string | null;
};

export type MeritCheck = {
  kpi: {
    invoices: number;
    with_card: number;
    missing: number;
    not_required: number;
    accepted_no_card: number;
    rejected: number;
    total: number;
    discount_total: number;
  };
  invoices: MeritInvoiceView[];
  cards: MeritCardView[];
  rule: Array<{ store_code: string; start: string }>;
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: Prisma.Decimal | null | undefined) => (v == null ? 0 : Number(v));

export async function buildMeritCheck(
  prisma: PrismaClient,
  filter: { store_ids?: string[] | null; date_from?: string; date_to?: string }
): Promise<MeritCheck> {
  const where: Prisma.NebimSaleLineWhereInput = { ...MERIT_LINE_WHERE };
  if (filter.store_ids) where.store_id = { in: filter.store_ids };
  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (filter.date_from) dateFilter.gte = new Date(`${filter.date_from}T00:00:00.000Z`);
  if (filter.date_to) dateFilter.lte = new Date(`${filter.date_to}T00:00:00.000Z`);
  if (dateFilter.gte || dateFilter.lte) where.invoice_date = dateFilter;

  const [lines, cardsRaw, reviews] = await Promise.all([
    prisma.nebimSaleLine.findMany({
      where,
      select: {
        invoice_ref: true,
        invoice_date: true,
        store_id: true,
        store_name_raw: true,
        nebim_store_code: true,
        customer_name: true,
        salesperson_name: true,
        qty: true,
        amount_vi: true,
        line_disc: true,
        doc_disc: true,
        mgmt_note: true,
        invoice_note: true,
        discount_reason: true,
        store: { select: { name: true } },
      },
      orderBy: { invoice_date: "desc" },
    }),
    prisma.meritCard.findMany({ where: { deleted_at: null }, orderBy: { uploaded_at: "desc" } }),
    prisma.meritInvoiceReview.findMany(),
  ]);

  // fiş bazında topla
  const byRef = new Map<string, MeritInvoiceView & { _doc: Set<string> }>();
  for (const l of lines) {
    let inv = byRef.get(l.invoice_ref);
    if (!inv) {
      const merit = [l.mgmt_note, l.invoice_note, l.discount_reason].find((n) => n && /merit/i.test(n)) ?? null;
      inv = {
        invoice_ref: l.invoice_ref,
        invoice_date: l.invoice_date.toISOString().slice(0, 10),
        store_id: l.store_id,
        store_name: l.store?.name ?? l.store_name_raw ?? "?",
        store_code: l.nebim_store_code,
        customer_name: l.customer_name,
        salesperson_name: l.salesperson_name,
        lines: 0,
        units: 0,
        total: 0,
        discount: 0,
        note: merit ? merit.replace(/\s+/g, " ").trim().slice(0, 160) : null,
        required: false,
        status: "not_required",
        match: null,
        card: null,
        suggestions: [],
        review_note: null,
        _doc: new Set(),
      };
      byRef.set(l.invoice_ref, inv);
    }
    inv.lines += 1;
    inv.units += num(l.qty);
    inv.total += num(l.amount_vi);
    inv.discount += num(l.line_disc);
    // dip iskonto fatura geneli — her satırda tekrar eder, bir kez say
    if (l.doc_disc != null && !inv._doc.has("doc")) {
      inv.discount += num(l.doc_disc);
      inv._doc.add("doc");
    }
  }

  // kart görünümleri + imzalı URL
  const urls = new Map<string, string | null>();
  await Promise.all(
    cardsRaw.map(async (c) => {
      try {
        urls.set(c.id, await createSignedReadUrl(c.storage_path, 3600));
      } catch {
        urls.set(c.id, null);
      }
    })
  );
  const cards: MeritCardView[] = cardsRaw.map((c) => ({
    id: c.id,
    full_name: c.full_name,
    id_no: c.id_no,
    company: c.company,
    department: c.department,
    photo_date: c.photo_date ? c.photo_date.toISOString().slice(0, 10) : null,
    source_name: c.source_name,
    ocr_status: c.ocr_status,
    is_card: c.is_card,
    ocr_error: c.ocr_error,
    note: c.note,
    uploaded_at: c.uploaded_at.toISOString(),
    url: urls.get(c.id) ?? null,
    linked: 0,
  }));
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const reviewByRef = new Map(reviews.map((r) => [r.invoice_ref, r]));
  const usable = cards.filter((c) => c.is_card && c.ocr_status === "done" && c.full_name);

  const invoices: MeritInvoiceView[] = [];
  for (const inv of Array.from(byRef.values())) {
    const { _doc: _ignored, ...rest } = inv;
    void _ignored;
    const v: MeritInvoiceView = { ...rest, total: r2(inv.total), discount: r2(inv.discount), units: r2(inv.units) };
    v.required = meritRuleApplies(v.store_code, v.invoice_date);
    const review = reviewByRef.get(v.invoice_ref) ?? null;
    v.review_note = review?.note ?? null;
    // adaylar: ad benzerliği; aynı gün çekilmiş kart +0,1 (eşik altındakileri öne alır)
    const scored = usable
      .map((c) => {
        let s = nameSimilarity(v.customer_name, c.full_name);
        if (s > 0 && c.photo_date && c.photo_date === v.invoice_date) s = Math.min(1, s + 0.1);
        return { c, s };
      })
      .filter((x) => x.s >= SUGGEST_MIN)
      .sort((a, b) => b.s - a.s);
    const best = scored[0] ?? null;
    const decision = (review?.decision as "card" | "no_card_ok" | "rejected" | undefined) ?? null;
    v.status = meritStatus({ decision, autoScore: best?.s ?? 0, required: v.required });
    if (decision === "card" && review?.card_id && cardById.has(review.card_id)) {
      const c = cardById.get(review.card_id)!;
      v.match = "manual";
      v.card = { id: c.id, full_name: c.full_name, id_no: c.id_no, company: c.company, url: c.url, score: null };
      c.linked += 1;
    } else if (decision === "card") {
      // kart silinmiş — karar geçersiz
      v.status = meritStatus({ decision: null, autoScore: best?.s ?? 0, required: v.required });
    }
    if (!v.card && v.status === "ok_card" && best) {
      v.match = "auto";
      v.card = { id: best.c.id, full_name: best.c.full_name, id_no: best.c.id_no, company: best.c.company, url: best.c.url, score: r2(best.s) };
      best.c.linked += 1;
    }
    v.suggestions = scored.slice(0, 3).map((x) => ({ id: x.c.id, full_name: x.c.full_name, id_no: x.c.id_no, score: r2(x.s) }));
    invoices.push(v);
  }

  const kpi = {
    invoices: invoices.length,
    with_card: invoices.filter((i) => i.status === "ok_card").length,
    missing: invoices.filter((i) => i.status === "missing").length,
    not_required: invoices.filter((i) => i.status === "not_required").length,
    accepted_no_card: invoices.filter((i) => i.status === "ok_no_card").length,
    rejected: invoices.filter((i) => i.status === "rejected").length,
    total: r2(invoices.reduce((s, i) => s + i.total, 0)),
    discount_total: r2(invoices.reduce((s, i) => s + i.discount, 0)),
  };
  return {
    kpi,
    invoices,
    cards,
    rule: Object.entries(MERIT_RULE_START).map(([store_code, start]) => ({ store_code, start })),
  };
}
