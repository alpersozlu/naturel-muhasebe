/**
 * Kartuş Puan vs Alışveriş Çeki on a Mavi (IT POS) summary, settled by the
 * same day's SAP dealer report, which counts loyalty and gift-card payments
 * separately and to the kuruş.
 *
 * Measured 22.09.2026 (Mavi Lefkoşa): the row printed "Kartuş Puan Toplam
 * 2.160,00" was transcribed with the label "Alışveriş Çeki Toplam"; the
 * payments still added up, so the read was accepted and the day showed
 * Kartuş 0 against SAP's 2.160 — "manipulation risk" on an honest day. A
 * narrow vision re-ask of the labels was tried and answered wrongly 2/2, so
 * the arbiter is SAP, deterministically:
 *  - summary voucher=X, loyalty empty; SAP loyalty≈X, gift 0  → loyalty=X
 *  - summary loyalty=X, voucher empty; SAP gift≈X, loyalty 0  → voucher=X
 *  - both empty but the summary's own residual (sales − cash − card) ≈ SAP
 *    loyalty (or gift): the row was dropped; the value comes from the
 *    summary's own totals, not from SAP.
 * Nothing changes when the numbers do not agree.
 */
export function reconcileExtraRowsWithSap(
  summary: { loyalty: number | null; voucher: number | null; sales?: number | null; cash?: number | null; card?: number | null },
  sap: { loyalty: number; gift: number }
): { loyalty: number | null; voucher: number | null; note: string } | null {
  const near = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) <= Math.max(1, b * 0.01);
  const zero = (a: number | null | undefined) => a == null || Math.abs(a) < 0.005;
  if (zero(summary.loyalty) && summary.voucher != null && summary.voucher > 0 && near(summary.voucher, sap.loyalty) && zero(sap.gift)) {
    return { loyalty: summary.voucher, voucher: null, note: `Alışveriş Çeki ${summary.voucher} → Kartuş Puan (SAP kartuş ${sap.loyalty}, hediye 0)` };
  }
  if (zero(summary.voucher) && summary.loyalty != null && summary.loyalty > 0 && near(summary.loyalty, sap.gift) && zero(sap.loyalty)) {
    return { loyalty: null, voucher: summary.loyalty, note: `Kartuş Puan ${summary.loyalty} → Alışveriş Çeki (SAP hediye ${sap.gift}, kartuş 0)` };
  }
  if (zero(summary.loyalty) && zero(summary.voucher) && summary.sales != null && summary.cash != null && summary.card != null) {
    const residual = Math.round((summary.sales - summary.cash - summary.card) * 100) / 100;
    if (residual > 0 && near(residual, sap.loyalty) && zero(sap.gift)) {
      return { loyalty: residual, voucher: null, note: `Kartuş Puan satırı okunmamış; özetin kendi kalanı ${residual} = SAP kartuş ${sap.loyalty}` };
    }
    if (residual > 0 && near(residual, sap.gift) && zero(sap.loyalty)) {
      return { loyalty: null, voucher: residual, note: `Alışveriş Çeki satırı okunmamış; özetin kendi kalanı ${residual} = SAP hediye ${sap.gift}` };
    }
  }
  return null;
}
