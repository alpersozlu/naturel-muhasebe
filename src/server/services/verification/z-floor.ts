/**
 * Z below Visa — the hard rule: the day's total Z (Z report + manual
 * invoices) may never be lower than the card sales of the same day.
 * Card sales = the larger of the POS slips total and the store summary's
 * credit-card total, so an omitted slip does not lower the bar.
 *
 * Measured 2026-09-23: Mavi Girne 22.09.2026 was locked with Z 105.000,00
 * against Visa 106.486,89 — the lock gate checked that a Z existed, never
 * its amount. The Visa × 1.05 cushion when cash is present stays a
 * warning (business rule), this floor blocks.
 */
export type ZFloorShortfall = {
  combined: number;
  z_report: number;
  manual_invoice: number;
  visa: number;
  pos_total: number;
  summary_card: number;
  shortfall: number;
};

type Row = {
  z_compliance?: {
    z_report_total: number;
    manual_invoice_total: number;
    visa_total: number;
    summary_card?: number;
    hard_floor?: number;
  };
};

export function zBelowVisa(rows: Row[]): ZFloorShortfall | null {
  const z = rows.find((r) => r.z_compliance)?.z_compliance;
  if (!z) return null;
  const combined = z.z_report_total + z.manual_invoice_total;
  const visa = z.hard_floor ?? z.visa_total;
  if (combined <= 0.005 || visa <= 0.005) return null; // no Z yet / no card sales: other gates speak
  if (combined >= visa - 1) return null; // kuruş rounding between slip and summary
  return {
    combined,
    z_report: z.z_report_total,
    manual_invoice: z.manual_invoice_total,
    visa,
    pos_total: z.visa_total,
    summary_card: z.summary_card ?? z.visa_total,
    shortfall: Math.round((visa - combined) * 100) / 100,
  };
}

const TRY = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function zFloorMessage(f: ZFloorShortfall): string {
  return (
    `Z raporu Visa'nın altında — gün kapatılamaz. Toplam Z ${TRY.format(f.combined)} ₺, ` +
    `Visa (kredi kartı satışı) ${TRY.format(f.visa)} ₺ — POS fişleri ${TRY.format(f.pos_total)} ₺ ile ` +
    `mağaza özeti kredi kartı ${TRY.format(f.summary_card)} ₺ arasından büyük olan. Z en az Visa kadar olmalı: ` +
    `${TRY.format(f.shortfall)} ₺ eksik. Z raporunu kontrol edin; kartla yapılan satış ` +
    `yazar kasadan geçmediyse aradaki farkı El Faturası ile tamamlayın, sonra günü kilitleyin.`
  );
}
