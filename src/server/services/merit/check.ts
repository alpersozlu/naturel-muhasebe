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
 * kırmızı değildir. Mağusa 21.11.2026'dan (Nebim Merit kampanyasıyla) programda.
 *
 * Nebim "MERİT KAMPANYASI" (20.11.2026, YUKLE24B/25/26): kasiyer İndirim Çeki
 * Kullan penceresinde "MERİT %10" seçip personelin sicil numarasını yazar; Nebim
 * outlet hariç ürünlerin kampanyalı fiyatına %10 uygular. Fişte yönetim notu ve dip
 * iskonto YOK — indirim satır kampanyası (line_disc) içinde, satırın `campaign`
 * alanında "MERİT KAMPANYASI" yazar. Böyle fiş onaylı sayılır ve ek %10 Nebim'in
 * hesabıdır; aynı fişte elle dip iskonto da varsa ÇİFT indirimdir.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { createSignedReadUrl } from "@/server/services/storage";
import { loadStaffIndex, matchStaff } from "./staff";
import { nameSimilarity } from "./cards";

/** NEBİM mağaza kodu → kartın zorunlu olduğu ilk gün */
export const MERIT_RULE_START: Record<string, string> = {
  S03: "2026-01-01", // Derimod Girne — baştan beri
  S01: "2026-10-08", // Derimod Lefkoşa — 08.10.2026'dan itibaren
  S02: "2026-11-21", // Derimod Mağusa — Nebim Merit kampanyasıyla (sahibi 19.11.2026: üç mağaza)
};
export const AUTO_MATCH_MIN = 0.8;
export const SUGGEST_MIN = 0.4;

export type MeritStatus = "ok_card" | "ok_list" | "ok_no_card" | "missing" | "not_required" | "rejected";

/**
 * EK %10 nasıl görünür (09.10.2026, ham satırlardan): kampanya indirimi satır
 * iskontosudur (line_disc); sahibinin manuel %10'u DİP İSKONTO (doc_disc) olarak
 * satırlara dağıtılır = (fiyat × adet − satır iskontosu) × %10. Örn. Hatice Özer
 * 30.09: 9.999,99 − 2.000 = 7.999,99 → dip 800,00. Oran 8,5–11,5 arası "%10
 * uygulandı" (küsurat / blink hariç tutma). Halyna Tanık 08.10: 245,97 / 3.959,97
 * = %6,2 → %10 DEĞİL.
 */
export const EXTRA_OK_RANGE: [number, number] = [0.085, 0.115];

export function extraRateOf(baseAfterLineDisc: number, docDisc: number): number | null {
  if (baseAfterLineDisc <= 0.005) return null;
  return Math.round((docDisc / baseAfterLineDisc) * 10000) / 10000;
}
export function isExtraOk(rate: number | null): boolean {
  return rate != null && rate >= EXTRA_OK_RANGE[0] && rate <= EXTRA_OK_RANGE[1];
}
/** Yönetim notu (sahibi yazar) hem "10" hem otel adı içeriyor mu. */
/** Yönetim notunda otel adı geçmesi yeter (sahibi, 19.10.2026: "merit yazması yeter"; önce "%10" da aranıyordu). */
export function noteApproves(mgmtNote: string | null | undefined): boolean {
  if (!mgmtNote) return false;
  return !!hotelOf(mgmtNote);
}

export function meritRuleApplies(storeCode: string | null, dateIso: string): boolean {
  const start = storeCode ? MERIT_RULE_START[storeCode] : undefined;
  return !!start && dateIso >= start;
}

/** Durum kararı — saf; test edilir. */
export function meritStatus(input: {
  decision: "card" | "no_card_ok" | "rejected" | null;
  autoScore: number;
  required: boolean;
  /** kurumun personel listesinde ad eşleşmesi (0–1); liste yoksa 0 */
  listScore?: number;
}): MeritStatus {
  if (input.decision === "card") return "ok_card";
  if (input.decision === "no_card_ok") return "ok_no_card";
  if (input.decision === "rejected") return "rejected";
  if (input.autoScore >= AUTO_MATCH_MIN) return "ok_card";
  if ((input.listScore ?? 0) >= AUTO_MATCH_MIN) return "ok_list"; // sahibi 20.10.2026: listedeki isimle tutması yeter
  return input.required ? "missing" : "not_required";
}

/**
 * Anlaşmalı kurum tanıma — yönetim notu / fiş notu / iskonto nedeni / kampanya.
 * Merit kasada "merit", "merıt" (noktasız ı), "mrt" diye yazılıyor (09.10.2026:
 * 43 düz + 4 varyant). Diğer anlaşmalılar (Cratos, Lord's Palace, Acapulco,
 * Tip-İş) da listelenir ama kart programı yalnız Merit'te.
 */
export const HOTEL_PATTERNS: Array<{ hotel: string; re: RegExp; needles: string[] }> = [
  // "MERİT" (büyük noktalı İ) ayrı: Postgres ILIKE 'merit' onu yakalamaz (Nebim kampanya adı "MERİT KAMPANYASI")
  { hotel: "Merit", re: /m\s*e\s*r\s*[iı]\s*t|\bmrt\b/i, needles: ["merit", "merıt", "mrt", "MERİT"] },
  { hotel: "Cratos", re: /crat+os/i, needles: ["cratos", "crattos"] },
  { hotel: "Lord's Palace", re: /lord/i, needles: ["lord"] },
  // Les Ambassadeurs (Girne) — notta "Les %10" ya da "ambassadeur" (20.10.2026, personel listesi geldi)
  { hotel: "Les Ambassadeurs", re: /ambas+ad|(^|[^a-zçğıöşü])les([^a-zçğıöşü]|$)/i, needles: ["ambassad", "ambasad", "les "] },
  { hotel: "Acapulco", re: /acapulco/i, needles: ["acapulco"] },
  { hotel: "Tip-İş", re: /t[iı]p[- ]?[iı][sş]/i, needles: ["tip-is", "tip is", "tıp ıs", "tip-iş", "tipis"] },
];
const NOTE_FIELDS = ["mgmt_note", "invoice_note", "discount_reason", "campaign"] as const;
/** Kart programı olmayan anlaşmalı kurumlar — Otel %10 kontrolünde listelenmez (sahibi 20.10.2026: "Tip-İş'leri çıkar"). */
export const NO_CARD_PROGRAMS = new Set<string>(["Tip-İş"]);

export function hotelOf(text: string): string | null {
  const t = text.toLocaleLowerCase("tr");
  for (const h of HOTEL_PATTERNS) if (h.re.test(t)) return h.hotel;
  return null;
}

/** Satırın kampanya alanında Nebim "MERİT KAMPANYASI" var mı (kasada MERİT %10 çeki + sicil). */
export function isMeritCampaign(campaign: string | null | undefined): boolean {
  if (!campaign) return false;
  return /m\s*e\s*r\s*[iı]\s*t\s*kampanyas/.test(campaign.toLocaleLowerCase("tr"));
}

/**
 * Ek %10 kararı — saf; test edilir. Elle Merit: dip iskonto ÷ kampanya sonrası tutar ≈ %10.
 * Kampanyalı Merit: oranı Nebim uygular (outlet hariç, kampanyalı fiyattan; Lefkoşa testi
 * 20.11.2026 kuruşu kuruşuna) → tamam; ama elle dip iskonto da girildiyse ÇİFT indirim.
 */
export function extraCheck(viaCampaign: boolean, baseAfterLineDisc: number, docDisc: number): { extra_rate: number | null; extra_ok: boolean; double_discount: boolean } {
  const rate = extraRateOf(baseAfterLineDisc, docDisc);
  if (!viaCampaign) return { extra_rate: rate, extra_ok: isExtraOk(rate), double_discount: false };
  if (docDisc > 0.005) return { extra_rate: rate, extra_ok: false, double_discount: true };
  return { extra_rate: null, extra_ok: true, double_discount: false };
}

export const MERIT_LINE_WHERE: Prisma.NebimSaleLineWhereInput = {
  is_return: false,
  OR: HOTEL_PATTERNS.flatMap((h) => h.needles.flatMap((n) => NOTE_FIELDS.map((f) => ({ [f]: { contains: n, mode: "insensitive" as const } })))),
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
  /** yükleyen mağaza (mağaza kutusundan geldiyse), yönetici yüklemesinde null */
  store_name: string | null;
  url: string | null;
  /** bu karta bağlı (elle ya da otomatik) fiş sayısı */
  linked: number;
  /**
   * Merit notu OLMAYAN ama aynı adla kesilmiş fişler (tüm Nebim, Ocak 2026'dan
   * beri): "kart var, eşleşme yok" ne demek — kişi hiç gelmemiş mi, yoksa
   * indirimsiz / notsuz mu almış? Yalnız eşleşmeyen kartlar için doldurulur.
   */
  /** Eşleşmeyen kart: aynı adla Nebim'de fiş var mı (tüm tarihler). merit_count = yönetim notunda Merit yazan fişler (tarih filtresi dışında kalmış olabilir) */
  other: { count: number; last_date: string | null; customer_name: string | null; merit_count: number; merit_last: string | null } | null;
  /** aynı kişinin fişle eşleşmiş başka bir kartı var (mükerrer yükleme) */
  duplicate_of?: { id: string; full_name: string | null; store_name: string | null } | null;
};

export type MeritInvoiceView = {
  invoice_ref: string;
  /** Anlaşmalı kurum (Merit, Cratos, Lord's Palace, Acapulco, Tip-İş) */
  hotel: string;
  invoice_date: string;
  store_id: string | null;
  store_name: string;
  store_code: string | null;
  customer_name: string | null;
  salesperson_name: string | null;
  lines: number;
  units: number;
  total: number; // Σ Tutar (KDV dahil, satılan)
  discount: number; // Σ satır + dip iskonto (tüm satırlar)
  note: string | null; // merit geçen not (yönetim / fiş)
  /** yönetim notu (sahibi yazar) — "%10 Merit" */
  mgmt_note: string | null;
  /** yönetim notunda otel adı var (sahibinin onayı; 'merit' yazması yeter) */
  note_ok: boolean;
  /** ek indirim oranı = Σ dip iskonto ÷ Σ (fiyat×adet − satır iskontosu); null = hesaplanamadı */
  extra_rate: number | null;
  /** ek indirim gerçekten ≈ %10 */
  extra_ok: boolean;
  /** Merit Nebim kampanyasıyla (kasada MERİT %10 çeki + sicil) uygulandı */
  via_campaign: boolean;
  /** kampanya + elle dip iskonto birlikte → müşteri iki kez indirim aldı */
  double_discount: boolean;
  required: boolean;
  status: MeritStatus;
  match: "manual" | "auto" | null;
  card: { id: string; full_name: string | null; id_no: string | null; company: string | null; url: string | null; score: number | null } | null;
  /** kurumun personel listesinde eşleşen ad (kart yerine geçer) */
  list_match: { full_name: string; score: number } | null;
  suggestions: Array<{ id: string; full_name: string | null; id_no: string | null; score: number }>;
  review_note: string | null;
};

export type MeritCheck = {
  kpi: {
    /** Merit fişi (tüm yazımlar) */
    invoices: number;
    /** diğer anlaşmalı kurumlar: ad → fiş sayısı */
    other_hotels: Record<string, number>;
    /** Merit fişi ama ek indirim ≈%10 değil ya da yönetim notu eksik */
    extra_mismatch: number;
    /** kampanya + elle dip iskonto (çift indirim) */
    double_discount: number;
    /** Nebim Merit kampanyasıyla gelen fiş */
    via_campaign: number;
    note_incomplete: number;
    with_card: number;
    /** personel listesiyle onaylı */
    with_list: number;
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
  /** yüklü personel listeleri: kurum → kişi sayısı */
  staff_lists: Array<{ hotel: string; count: number; uploaded_at: string | null; source_name: string | null }>;
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

  const lineSelect = {
    invoice_ref: true,
    invoice_date: true,
    store_id: true,
    store_name_raw: true,
    nebim_store_code: true,
    customer_name: true,
    salesperson_name: true,
    qty: true,
    price: true,
    amount_vi: true,
    line_disc: true,
    doc_disc: true,
    mgmt_note: true,
    invoice_note: true,
    discount_reason: true,
    campaign: true,
    store: { select: { name: true } },
  } as const;
  // Önce anlaşmalı notu/kampanyası olan fişler, sonra o fişlerin TÜM satırları: kampanyalı
  // Merit'te outlet satırının kampanya alanında Merit yazmaz, ama fiş toplamına girer.
  const loadLines = async () => {
    const hits = await prisma.nebimSaleLine.findMany({ where, select: { invoice_ref: true }, distinct: ["invoice_ref"] });
    if (hits.length === 0) return [];
    return prisma.nebimSaleLine.findMany({
      where: { invoice_ref: { in: hits.map((h) => h.invoice_ref) }, is_return: false, ...(filter.store_ids ? { store_id: { in: filter.store_ids } } : {}) },
      select: lineSelect,
      orderBy: [{ invoice_date: "desc" }, { invoice_ref: "asc" }],
    });
  };
  const [lines, cardsRaw, reviews, staffIndex, staffMeta] = await Promise.all([
    loadLines(),
    prisma.meritCard.findMany({ where: { deleted_at: null }, orderBy: { uploaded_at: "desc" }, include: { store: { select: { name: true } } } }),
    prisma.meritInvoiceReview.findMany(),
    loadStaffIndex(prisma),
    prisma.hotelStaff.groupBy({ by: ["hotel"], where: { deleted_at: null }, _count: { _all: true }, _max: { uploaded_at: true, source_name: true } }),
  ]);

  // fiş bazında topla (kurum ve kampanya fişin bütün satırlarından okunur)
  const groups = new Map<string, typeof lines>();
  for (const l of lines) {
    const g = groups.get(l.invoice_ref);
    if (g) g.push(l);
    else groups.set(l.invoice_ref, [l]);
  }
  const byRef = new Map<string, MeritInvoiceView & { _base: number; _doc: number }>();
  for (const [ref, ls] of Array.from(groups.entries())) {
    const noteText = ls.flatMap((l) => [l.mgmt_note, l.invoice_note, l.discount_reason, l.campaign]).filter(Boolean).join(" | ");
    const hotel = hotelOf(noteText);
    if (!hotel) continue; // satır başka nedenle gelmiş olabilir (kampanya adı vb.)
    if (NO_CARD_PROGRAMS.has(hotel)) continue; // Tip-İş: kart programı yok, bu kontrolün dışında (sahibi 20.10.2026)
    const l0 = ls[0]!;
    const viaCampaign = hotel === "Merit" && ls.some((l) => isMeritCampaign(l.campaign));
    const mgmtNote = ls.find((l) => l.mgmt_note)?.mgmt_note ?? null;
    const merit = ls.flatMap((l) => [l.mgmt_note, l.invoice_note, l.discount_reason]).find((n) => n && hotelOf(n)) ?? null;
    const inv: MeritInvoiceView & { _base: number; _doc: number } = {
      invoice_ref: ref,
      hotel,
      invoice_date: l0.invoice_date.toISOString().slice(0, 10),
      store_id: l0.store_id,
      store_name: l0.store?.name ?? l0.store_name_raw ?? "?",
      store_code: l0.nebim_store_code,
      customer_name: l0.customer_name,
      salesperson_name: l0.salesperson_name,
      lines: 0,
      units: 0,
      total: 0,
      discount: 0,
      note: merit ? merit.replace(/\s+/g, " ").trim().slice(0, 160) : viaCampaign ? "MERİT KAMPANYASI (kasada çek + sicil)" : null,
      mgmt_note: mgmtNote?.replace(/\s+/g, " ").trim().slice(0, 160) ?? null,
      note_ok: noteApproves(mgmtNote) || viaCampaign,
      extra_rate: null,
      extra_ok: false,
      via_campaign: viaCampaign,
      double_discount: false,
      required: false,
      status: "not_required",
      match: null,
      card: null,
      list_match: null,
      suggestions: [],
      review_note: null,
      _base: 0,
      _doc: 0,
    };
    for (const l of ls) {
      inv.lines += 1;
      inv.units += num(l.qty);
      inv.total += num(l.amount_vi);
      // satır iskontosu = kampanya (kampanyalı Merit dahil); dip iskonto = satırlara dağıtılmış manuel ek indirim
      inv.discount += num(l.line_disc) + num(l.doc_disc);
      inv._base += num(l.price) * num(l.qty) - num(l.line_disc);
      inv._doc += num(l.doc_disc);
    }
    byRef.set(ref, inv);
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
    store_name: c.store?.name ?? null,
    url: urls.get(c.id) ?? null,
    linked: 0,
    other: null,
    duplicate_of: null,
  }));
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const reviewByRef = new Map(reviews.map((r) => [r.invoice_ref, r]));
  const usable = cards.filter((c) => c.is_card && c.ocr_status === "done" && c.full_name);

  const invoices: MeritInvoiceView[] = [];
  for (const inv of Array.from(byRef.values())) {
    const { _base, _doc, ...rest } = inv;
    const ex = extraCheck(inv.via_campaign, _base, _doc);
    const v: MeritInvoiceView = { ...rest, total: r2(inv.total), discount: r2(inv.discount), units: r2(inv.units), ...ex };
    // Sahibi (20.10.2026): kart yalnız Merit'e değil, tüm anlaşmalı kurumlara (Cratos, Lord's Palace…) aranır.
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
    v.list_match = matchStaff(staffIndex, v.hotel, v.customer_name);
    v.status = meritStatus({ decision, autoScore: best?.s ?? 0, required: v.required, listScore: v.list_match?.score ?? 0 });
    if (decision === "card" && review?.card_id && cardById.has(review.card_id)) {
      const c = cardById.get(review.card_id)!;
      v.match = "manual";
      v.card = { id: c.id, full_name: c.full_name, id_no: c.id_no, company: c.company, url: c.url, score: null };
      c.linked += 1;
    } else if (decision === "card") {
      // kart silinmiş — karar geçersiz
      v.status = meritStatus({ decision: null, autoScore: best?.s ?? 0, required: v.required, listScore: v.list_match?.score ?? 0 });
    }
    if (!v.card && v.status === "ok_card" && best) {
      v.match = "auto";
      v.card = { id: best.c.id, full_name: best.c.full_name, id_no: best.c.id_no, company: best.c.company, url: best.c.url, score: r2(best.s) };
      best.c.linked += 1;
    }
    v.suggestions = scored.slice(0, 3).map((x) => ({ id: x.c.id, full_name: x.c.full_name, id_no: x.c.id_no, score: r2(x.s) }));
    invoices.push(v);
  }

  // Eşleşmeyen kartlar: aynı adla Merit notsuz fiş var mı? (tüm Nebim)
  const orphans = cards.filter((c) => c.linked === 0 && c.is_card && c.ocr_status === "done" && c.full_name);
  // Aynı adlı başka bir kart zaten fişle eşleştiyse bu kart mükerrerdir (yönetici + mağaza
  // aynı kişiyi yüklemiş) — "fişi yok" değil.
  const linkedCards = cards.filter((c) => c.linked > 0 && c.full_name);
  for (const c of orphans) {
    const twin = linkedCards.find((l) => nameSimilarity(c.full_name, l.full_name) >= AUTO_MATCH_MIN);
    if (twin) c.duplicate_of = { id: twin.id, full_name: twin.full_name, store_name: twin.store_name };
  }
  if (orphans.length > 0) {
    const names = await prisma.nebimSaleLine.findMany({ where: { customer_name: { not: null } }, distinct: ["customer_name"], select: { customer_name: true } });
    const all = names.map((n) => n.customer_name!);
    for (const c of orphans) {
      const best = all.map((n) => ({ n, s: nameSimilarity(c.full_name, n) })).filter((x) => x.s >= AUTO_MATCH_MIN).sort((a, b) => b.s - a.s)[0];
      if (!best) {
        c.other = { count: 0, last_date: null, customer_name: null, merit_count: 0, merit_last: null };
        continue;
      }
      const inv = await prisma.nebimSaleLine.findMany({ where: { customer_name: best.n, is_return: false }, select: { invoice_ref: true, invoice_date: true, mgmt_note: true, invoice_note: true, discount_reason: true, campaign: true }, orderBy: { invoice_date: "desc" } });
      const refs = new Map<string, { date: Date; merit: boolean }>();
      for (const l of inv) {
        const r = refs.get(l.invoice_ref) ?? { date: l.invoice_date, merit: false };
        if (hotelOf([l.mgmt_note, l.invoice_note, l.discount_reason, l.campaign].filter(Boolean).join(" | "))) r.merit = true;
        refs.set(l.invoice_ref, r);
      }
      const refList = Array.from(refs.values());
      const merit = refList.filter((r) => r.merit);
      c.other = { count: refList.length, last_date: refList[0]?.date.toISOString().slice(0, 10) ?? null, customer_name: best.n, merit_count: merit.length, merit_last: merit[0]?.date.toISOString().slice(0, 10) ?? null };
    }
  }

  const meritInv = invoices; // tüm anlaşmalı kurumlar (Merit, Cratos, Lord's Palace, Acapulco, Tip-İş)
  const other_hotels: Record<string, number> = {};
  for (const i of invoices) other_hotels[i.hotel] = (other_hotels[i.hotel] ?? 0) + 1;
  const kpi = {
    invoices: meritInv.length,
    other_hotels,
    extra_mismatch: meritInv.filter((i) => !i.extra_ok).length,
    double_discount: meritInv.filter((i) => i.double_discount).length,
    via_campaign: meritInv.filter((i) => i.via_campaign).length,
    note_incomplete: meritInv.filter((i) => !i.note_ok).length,
    with_card: invoices.filter((i) => i.status === "ok_card").length,
    with_list: invoices.filter((i) => i.status === "ok_list").length,
    missing: invoices.filter((i) => i.status === "missing").length,
    not_required: meritInv.filter((i) => i.status === "not_required").length,
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
    staff_lists: staffMeta.map((s) => ({ hotel: s.hotel, count: s._count._all, uploaded_at: s._max.uploaded_at?.toISOString() ?? null, source_name: s._max.source_name ?? null })),
  };
}
