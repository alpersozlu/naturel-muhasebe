import "server-only";

/**
 * A Mavi day whose register was not closed carries a CUMULATIVE store
 * summary: it includes the previous day's sales. The reconciliation
 * engine subtracts the previous summary (compute.ts); every other reader
 * of StoreSummary must do the same, or the previous day is counted twice
 * (revenue, P&L, Z analysis, cash variance all did).
 */
type Dec = { toNumber: () => number } | null | undefined;

export type SummaryDecimals = {
  sales_total_try: Dec;
  cash_sales_try: Dec;
  credit_card_total_try: Dec;
  loyalty_points_total_try: Dec;
  wire_transfer_total_try?: Dec;
};

const n = (v: Dec) => (v ? v.toNumber() : 0);

export function effectiveSummary(
  s: SummaryDecimals,
  prev: SummaryDecimals | null | undefined
): { sales: number; cash: number; cc: number; loyalty: number; wire: number } {
  return {
    sales: n(s.sales_total_try) - (prev ? n(prev.sales_total_try) : 0),
    cash: n(s.cash_sales_try) - (prev ? n(prev.cash_sales_try) : 0),
    cc: n(s.credit_card_total_try) - (prev ? n(prev.credit_card_total_try) : 0),
    loyalty: n(s.loyalty_points_total_try) - (prev ? n(prev.loyalty_points_total_try) : 0),
    wire: n(s.wire_transfer_total_try) - (prev ? n(prev.wire_transfer_total_try) : 0),
  };
}

/** Prisma `select` for the previous day's summary, to include under `cumulative_prev`. */
export const cumulativePrevSummarySelect = {
  store_summary: {
    select: {
      sales_total_try: true,
      cash_sales_try: true,
      credit_card_total_try: true,
      loyalty_points_total_try: true,
      wire_transfer_total_try: true,
    },
  },
} as const;
