// Prim ve mesai girişi tablosunu jsdom'da gerçek hesap motoruyla çizer (giriş gerektiren ekran).
// Kontrol: sütun sırası, kesinti/ekleme sebep etiketleri (kind'a göre), top-seller tutarı,
// mesai ücreti sütunu ve Ödeme 2 dökümünün ödenecek tutara eşitliği.
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it, vi } from "vitest";

const SCRATCH = "/private/tmp/claude-501/-Users-alpersozlu/88a06dc9-7bb2-4c5f-935d-dcc9ad5dd828/scratchpad/domtest/node_modules/jsdom";

vi.mock("@/lib/trpc", () => {
  const q = { data: undefined, isFetching: false, error: null, refetch: async () => {} };
  const m = () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false });
  return {
    trpc: {
      payroll: {
        lines: { update: { useMutation: m } },
        entries: { carryForward: { useMutation: m } },
        performance: { get: { useQuery: () => q } },
        kolayik: { month: { useQuery: () => q } },
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => async () => false }));
vi.mock("@/components/payroll/kolayik-panel", () => ({ KolayikPanel: () => null }));
vi.mock("@/components/payroll/sunday-audit", () => ({ SundayAuditPanel: () => null }));
vi.mock("@/components/payroll/performance-docs", () => ({ PerformanceDocs: () => null }));
vi.mock("@/components/payroll/entry-dialog", () => ({ EntryDialog: () => null }));

let React: any;
let act: any;
let createRoot: any;
let ExtrasGrid: any;
let computeLine: any;

const entry = (id: string, kind: string, category: string, amount: number, note = "n") => ({
  id, kind, category, channel: null, entry_date: "2026-09-30", amount, note, reference: null, voided_at: null, batch: null, carry_id: null,
});
const line = (over: any, entries: any[], store: { revenue: number | null; target: number | null }) => {
  const base = {
    id: over.id, period_id: "p", employee_id: "e-" + over.id, store_id: over.store_id, store_name: over.store_name, brand_name: "x",
    full_name: over.full_name, position: over.position ?? "Satış Asistanı", commission_profile: over.commission_profile,
    pay_method: "cash", bank_account_name: null, has_bank_details: false, employee_status: "active", end_date: null, paid_month_early: false,
    perfume_eligible: false, garment_eligible: over.garment_eligible ?? false, employee_notes: null,
    base_salary: 70893, overtime_hours: over.overtime_hours ?? 0, overtime_note: null,
    own_revenue_nd: over.own_revenue_nd ?? null, own_revenue_denim: over.own_revenue_denim ?? null, own_revenue: over.own_revenue ?? null, own_target: over.own_target ?? null,
    achievement_accepted: null, commission_override: null, commission_note: null, perfume_units: 0, garment_units: 0,
    top_seller: over.top_seller ?? false, extra_premium: over.extra_premium ?? 0, extra_premium_note: over.extra_premium_note ?? null, note: null, updated_at: "",
  };
  const input = { ...base, status: "active" };
  return { ...base, calc: computeLine(input, store, entries) };
};

// Öğeler arasına boşluk koyarak oku (textContent "etiket− tutar" diye yapıştırır)
const text = (el: Element | null) =>
  (el?.innerHTML ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

describe("ExtrasGrid", () => {
  beforeAll(async () => {
    const { JSDOM } = createRequire(import.meta.url)(SCRATCH);
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
    const g = globalThis as any;
    g.window = dom.window;
    g.document = dom.window.document;
    for (const k of ["navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "DocumentFragment", "CustomEvent", "DragEvent"]) {
      try { Object.defineProperty(g, k, { value: (dom.window as any)[k], configurable: true, writable: true }); } catch { /* read-only */ }
    }
    g.IS_REACT_ACT_ENVIRONMENT = true;
    React = await import("react");
    act = React.act;
    ({ createRoot } = await import("react-dom/client"));
    ({ computeLine } = await import("@/server/services/payroll/compute"));
    ({ ExtrasGrid } = await import("@/components/payroll/extras-grid"));
  });

  it("sütunlar, sebep etiketleri, top-seller tutarı, mesai ücreti ve Ödeme 2 dökümü", async () => {
    const deri = { revenue: 3_000_000, target: 3_200_000 };
    const mavi = { revenue: 3_997_275.7, target: 4_600_000 };
    // Oğuzhan benzeri: 9 s mesai, 18.000 çalışma izni + 24.539,88 "Diğer kesinti", 30.000 avans, 22.893 ödeme, 18.622,05 devir
    const og = line(
      { id: "og", store_id: "s1", store_name: "DERIMOD GIRNE", full_name: "Oguzhan Özçetin", commission_profile: "deri_asistan", own_revenue: 356_293, own_target: 400_000, overtime_hours: 9 },
      [
        entry("d1", "deduction", "work_permit", 18_000, "Çalışma izni"),
        entry("d2", "deduction", "other", 24_539.88, "Devamsızlık 02–11.09"),
        entry("a1", "advance", null as any, 30_000),
        entry("p1", "payment", "payment1", 22_893),
        entry("c1", "addition", "carry_forward", 18_622.05, "Ekim'e devir"),
      ],
      deri
    );
    // Mavi: top-seller + 5.453,31 ek prim + 2 giysi
    const mv = line(
      { id: "mv", store_id: "s2", store_name: "Mavi Magusa", full_name: "Ekin Doğan", commission_profile: "mavi_asistan", own_revenue_nd: 653_986.18, own_revenue_denim: 235_183.82, own_target: 1_186, top_seller: true, extra_premium: 5_453.31, extra_premium_note: "Çıkış", garment_eligible: false },
      [entry("p2", "payment", "payment1", 70_893), entry("ad1", "addition", "bonus", 1_000, "Ödül")],
      mavi
    );
    const block = (id: string, name: string, is_mavi: boolean, s: any, lines: any[]) => ({
      store_id: id, store_name: name, brand_name: "x", is_mavi, revenue: s.revenue, target: s.target, revenue_source: null, notes: null,
      achievement: s.revenue / s.target, lines, totals: { base: 0, gross: 0, paid: 0, remaining: 0, advances: 0, open: 0 },
    });
    const data = {
      period: { id: "p", year: 2026, month: 9, label: "Eylül 2026", status: "open", notes: null, closed_at: null },
      stores: [block("s1", "DERIMOD GIRNE", false, deri, [og]), block("s2", "Mavi Magusa", true, mavi, [mv])],
      totals: {} as any,
      batches: [],
    };
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(React.createElement(ExtrasGrid, { data, closed: false, onChanged: () => {}, onOpenLine: () => {} }));
    });

    const headers = Array.from(document.querySelector("table")!.querySelectorAll("thead th")).map((th) => text(th)).filter(Boolean);
    expect(headers).toEqual(["Çalışan", "Mesai (saat)", "Ciro", "Hedef", "Komisyon", "Primler", "Mesai ücreti", "Ekleme / kesinti", "Ödeme 2"]);

    const rows = Array.from(document.querySelectorAll("tbody tr"));
    const ogRow = rows.find((r) => text(r).includes("Oguzhan"))!;
    const ogCells = Array.from(ogRow.querySelectorAll("td")).map(text);
    // Ekleme / kesinti: sebep + işaretli tutar; "Diğer kesinti" artık "Diğer ek hak ediş" değil
    expect(ogCells[7]).toContain("Çalışma izni borcu − 18.000,00");
    expect(ogCells[7]).toContain("Diğer kesinti − 24.539,88");
    expect(ogCells[7]).not.toContain("ek hak ediş");
    expect(ogCells[7]).toContain("Ekim 2026 maaşına devredildi → 18.622,05");
    // Mesai ücreti sütunu: 9 s × 340,83 = 3.067,49
    expect(ogCells[6]).toContain("3.067,49");
    expect(ogCells[6]).toContain("9 s × 340,83");
    // Ödeme 2 dökümü ve ödenecek tutar motorla aynı
    expect(ogCells[8]).toContain("Komisyon + 2.850,34");
    expect(ogCells[8]).toContain("Kesintiler − 42.539,88");
    expect(ogCells[8]).toContain("Ekim 2026 maaşına devir + 18.622,05");
    expect(ogCells[8]).toContain("Ödenmeyen maaş bakiyesi + 18.000,00");
    expect(ogCells[8]).toContain(`Ödenecek ${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2 }).format(og.calc.payment2_due)} ₺`);
    expect(og.calc.payment2_due).toBeCloseTo(0, 2); // devirden sonra sıfır

    const mvRow = rows.find((r) => text(r).includes("Ekin"))!;
    const mvCells = Array.from(mvRow.querySelectorAll("td")).map(text);
    expect(mvCells[5]).toContain("top-seller +3.000,00");
    expect(mvCells[6]).toBe("—"); // mesai yok
    expect(mvCells[7]).toContain("Bonus / ödül + 1.000,00");
    expect(mvCells[8]).toContain("Top-seller + 3.000,00");
    expect(mvCells[8]).toContain("Ek prim + 5.453,31");
    expect(mvCells[8]).toContain("Eklemeler + 1.000,00");
    // Bonus türü ekleme motorda Ödeme 1'e gider (baz + ekler − kesintiler) → dökümde tek satırla açıklanır
    expect(mvCells[8]).toContain("Ödeme 1 ile ödenir − 1.000,00");
    expect(mvCells[8]).not.toContain("maaş bakiyesi");
    const expected = mv.calc.commission.final + 3000 + 5453.31;
    expect(mv.calc.payment2_due).toBeCloseTo(expected, 2);
    expect(mvCells[8]).toContain(`Ödenecek ${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2 }).format(mv.calc.payment2_due)} ₺`);
  });
});
