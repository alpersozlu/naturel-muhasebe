/**
 * Sahibinin fatura fotoğrafı ↔ mağazanın yüklediği masraf kaydı eşleştirmesi.
 *
 * Sahibi (19.10.2026): "Fotoğrafı daha evvel mağaza tarafından yüklenmediyse
 * demek ki o fatura şirket faturasıdır." Mağaza "Yükle ve Analiz Et"te masraf
 * faturasını yüklediyse Expense kaydı vardır; aynı kâğıdın sahibi tarafından
 * çekilen ikinci fotoğrafı burada o kayda bağlanır (MAĞAZA FATURASI — kasada
 * zaten sayıldı). Bağlanamayan fatura ŞİRKET FATURASI olur (÷7 dağıtılır).
 *
 * Saf karar fonksiyonu test edilir; DB'ye dokunan kısım invoices.ts'te.
 */
import { nameSimilarity } from "@/server/services/merit/cards";
import { distinctDocumentNo, normalizeDocumentNo } from "@/server/services/ocr/process-upload";

export type InvoiceLike = {
  file_hash: string | null;
  vendor: string | null;
  document_no: string | null;
  expense_date: string | null; // YYYY-MM-DD
  amount_try: number | null;
};

export type ExpenseCandidate = {
  id: string;
  store_name: string;
  file_hash: string | null;
  vendor: string | null;
  document_no: string | null;
  expense_date: string; // YYYY-MM-DD
  amount_try: number;
};

export type MatchMethod = "file_hash" | "document_no" | "vendor_amount";
export type InvoiceMatch = { expense: ExpenseCandidate; method: MatchMethod; score: number } | null;

const AMOUNT_TOL = 0.02; // kuruş yuvarlaması
const DAY = 86_400_000;
/** Belge tarihi ile mağaza kaydının tarihi arasında izin verilen fark (gün). Mağaza faturayı
 *  genelde aynı gün yükler; tarih OCR'da ±1 gün kayabilir, hafta sonu 2 gün. */
const DATE_TOL_DAYS = 3;
export const VENDOR_MIN = 0.6;

function daysBetween(a: string, b: string): number {
  return Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);
}

/**
 * Adaylar arasından en güçlü eşleşmeyi seçer:
 *  1. aynı dosya (SHA-256) → kesin;
 *  2. basılı belge numarası iki tarafta da var ve aynı + tutar aynı → kesin;
 *  3. tutar aynı + tarih ±3 gün + satıcı adı benzer (≥0,6) → eşleşme (belge no
 *     ikisinde de varsa ve FARKLIYSA → ayrı fatura, eşleşmez).
 */
export function matchInvoiceToExpenses(inv: InvoiceLike, candidates: ExpenseCandidate[]): InvoiceMatch {
  if (inv.file_hash) {
    const same = candidates.find((c) => c.file_hash && c.file_hash === inv.file_hash);
    if (same) return { expense: same, method: "file_hash", score: 1 };
  }
  if (inv.amount_try == null) return null;
  const amountOk = candidates.filter((c) => Math.abs(c.amount_try - inv.amount_try!) <= AMOUNT_TOL);
  if (amountOk.length === 0) return null;

  const myNo = normalizeDocumentNo(inv.document_no);
  if (myNo) {
    const byNo = amountOk.find((c) => normalizeDocumentNo(c.document_no) === myNo);
    if (byNo) return { expense: byNo, method: "document_no", score: 0.98 };
  }

  let best: InvoiceMatch = null;
  for (const c of amountOk) {
    if (distinctDocumentNo(inv.document_no, c.document_no)) continue; // iki numara da var, farklı
    const dateOk = !inv.expense_date || daysBetween(inv.expense_date, c.expense_date) <= DATE_TOL_DAYS;
    if (!dateOk) continue;
    const sim = inv.vendor && c.vendor ? nameSimilarity(inv.vendor, c.vendor) : inv.vendor || c.vendor ? 0 : 0.5;
    // satıcı adı iki tarafta da okunamadıysa tutar+tarih (aynı gün) ile zayıf eşleşme
    const sameDay = !!inv.expense_date && daysBetween(inv.expense_date, c.expense_date) === 0;
    const score = sim >= VENDOR_MIN ? 0.7 + 0.25 * sim : sameDay && !inv.vendor && !c.vendor ? 0.6 : 0;
    if (score <= 0) continue;
    if (!best || score > best.score) best = { expense: c, method: "vendor_amount", score: Math.round(score * 1000) / 1000 };
  }
  return best;
}

/** İki sahibi fotoğrafı aynı faturayı mı gösteriyor? (mükerrer çekim) */
export function sameInvoice(a: InvoiceLike, b: InvoiceLike): boolean {
  if (a.file_hash && a.file_hash === b.file_hash) return true;
  if (a.amount_try == null || b.amount_try == null) return false;
  if (Math.abs(a.amount_try - b.amount_try) > AMOUNT_TOL) return false;
  if (distinctDocumentNo(a.document_no, b.document_no)) return false;
  const na = normalizeDocumentNo(a.document_no);
  if (na && na === normalizeDocumentNo(b.document_no)) return true;
  if (a.expense_date && b.expense_date && a.expense_date !== b.expense_date) return false;
  if (!a.vendor || !b.vendor) return false;
  return nameSimilarity(a.vendor, b.vendor) >= 0.8;
}
