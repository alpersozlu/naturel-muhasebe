/**
 * Kurumsal / yönetim alışverişi: girilen tutar bilgi fişiyle tutuyor mu?
 *
 * Olağan durum: tutar = fişteki "Ödenecek Tutar".
 *
 * BÖLÜNMÜŞ ÖDEME (sahibi, 11.11.2026 — Mavi Mağusa, Büşra Kaçmaz 9.239,94 ₺):
 * alışverişin bir kısmı yönetim/kurumsal, kalanını kişi kendi kartıyla öder.
 * Kasada yönetim kısmı NAKİT yazılır (Mavi kuralı), kart kısmı gün sonu POS
 * fişine düşer. Fişin "Ödeme Tipi" bölümünde iki satır olur; kayıt edilecek
 * tutar NAKİT satırıdır. Başka bir satırın tutarı kabul edilmez.
 */
export type ReceiptPayment = { label: string; amount: number };

export type ReceiptMatch =
  | { ok: true; kind: "full" }
  | { ok: true; kind: "cash_part"; cash: number; other: number; other_labels: string[] }
  | { ok: false; message: string };

/** Girilen tutar ile fişteki tutar arasında kabul edilen fark (₺). */
export const RECEIPT_AMOUNT_TOLERANCE = 0.5;

const fmt = (n: number) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;
const isCash = (label: string) => label.toLocaleLowerCase("tr").includes("nakit");

export function matchReceiptAmount(a: {
  amount: number;
  payable_total: number;
  payments?: ReceiptPayment[] | null;
}): ReceiptMatch {
  const tol = RECEIPT_AMOUNT_TOLERANCE;
  if (Math.abs(a.payable_total - a.amount) <= tol) return { ok: true, kind: "full" };

  const lines = (a.payments ?? []).filter((p) => p.amount > 0);
  const cash = r2(lines.filter((p) => isCash(p.label)).reduce((s, p) => s + p.amount, 0));
  const others = lines.filter((p) => !isCash(p.label));
  const other = r2(others.reduce((s, p) => s + p.amount, 0));
  // The payment lines must add up to the receipt itself, or they were misread.
  const split = cash > 0 && other > 0 && Math.abs(cash + other - a.payable_total) <= tol;

  if (split && Math.abs(cash - a.amount) <= tol) {
    return { ok: true, kind: "cash_part", cash, other, other_labels: others.map((p) => p.label.trim()) };
  }
  if (split) {
    return {
      ok: false,
      message:
        `Fişte ödeme bölünmüş: nakit ${fmt(cash)} ₺, diğer ${fmt(other)} ₺ (toplam ${fmt(a.payable_total)} ₺). ` +
        `Yönetim / kurumsal kısmı kasada nakit yazılan tutardır: ${fmt(cash)} ₺ girin. ` +
        `Girilen tutar ${fmt(a.amount)} ₺.`,
    };
  }
  return {
    ok: false,
    message:
      `Girilen tutar (${fmt(a.amount)} ₺) fişteki Ödenecek Tutar ile ` +
      `(${fmt(a.payable_total)} ₺) uyuşmuyor. ` +
      `Fark: ${fmt(Math.abs(a.payable_total - a.amount))} ₺. Doğru tutarı girin ya da doğru fişi yükleyin.`,
  };
}

/** Bölünmüş ödemede alışveriş kaydına düşülen açıklama. */
export function splitPaymentNote(m: Extract<ReceiptMatch, { kind: "cash_part" }>, payable: number): string {
  const who = m.other_labels.length ? ` (${m.other_labels.join(", ")})` : "";
  return `Fiş toplamı ${fmt(payable)} ₺; ${fmt(m.other)} ₺ kişinin kendi ödemesi${who}, gün sonuna satış olarak yansır.`;
}
