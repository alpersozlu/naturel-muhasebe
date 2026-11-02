import { describe, expect, it } from "vitest";
import { computeLine, type LineInput } from "@/server/services/payroll/compute";

// Sahibi 02.11.2026 (Dilber Günay): ayrılan personele fazla ödenen tutar sonraki aya
// devredilmez — satırda kırmızı borç kalır; para geri gelince "İade alındı" kapatır.
const line = (over: Partial<LineInput> = {}): LineInput => ({
  base_salary: 16605.33,
  commission_profile: "mavi_asistan",
  overtime_hours: 0,
  own_revenue_nd: null,
  own_revenue_denim: null,
  own_revenue: null,
  own_target: null,
  achievement_accepted: null,
  commission_override: 0,
  commission_note: "Prim yok",
  perfume_units: 0,
  garment_units: 0,
  top_seller: false,
  extra_premium: 0,
  extra_premium_note: null,
  paid_month_early: false,
  status: "left",
  ...over,
});
type Entries = Parameters<typeof computeLine>[2];
const e = (kind: "payment" | "addition", amount: number, category: string): Entries[number] => ({ id: `${kind}-${category}-${amount}`, kind, amount, category, note: "t", entry_date: "2026-11-02", voided_at: null, batch: null, channel: null, reference: null });
const STORE = { revenue: null, target: null };
const base = [e("payment", 61677, "payment1"), e("addition", 35582.85, "leave_payout"), e("addition", 3706.55, "other")];

describe("ayrılan personelin borcu", () => {
  it("fazla ödeme borç olarak görünür, devir önerilmez", () => {
    const c = computeLine(line(), STORE, base);
    expect(c.net_remaining).toBe(-5782.27);
    const f = c.flags.find((x) => x.code === "overpaid")!;
    expect(f.text).toContain("Borç: 5.782,27");
    expect(f.text).toContain("Sonraki aya devredilmez");
  });
  it("İade alındı bakiyeyi kapatır ama hak edişe (brüte) girmez", () => {
    const c = computeLine(line(), STORE, [...base, e("addition", 5782.27, "refund_received")]);
    expect(c.net_remaining).toBe(0);
    expect(c.gross).toBe(55894.73);
    expect(c.refund_received_total).toBe(5782.27);
    expect(c.flags.some((x) => x.code === "overpaid")).toBe(false);
  });
  it("çalışan personelde eski uyarı (devret) kalır", () => {
    const c = computeLine(line({ status: "active" }), STORE, base);
    expect(c.flags.find((x) => x.code === "overpaid")!.text).toContain('"Sonraki aya devret"');
  });
});
