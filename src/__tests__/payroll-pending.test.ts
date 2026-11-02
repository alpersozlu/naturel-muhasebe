import { describe, expect, it } from "vitest";
import { pendingCounts, pendingFor, pendingText, type PendingStore } from "@/lib/payroll-pending";

// Sahibi 02.11.2026: prim için beklenen belgeler mağaza mağaza izlensin.
const line = (full_name: string, commission_profile: string, own_target: number | null = null, employee_status: "active" | "left" = "active") => ({
  full_name,
  commission_profile,
  employee_status,
  own_target,
});

const magusa: PendingStore = {
  store_id: "m",
  store_name: "Mavi Magusa",
  is_mavi: true,
  revenue: 6229706,
  target: null,
  lines: [line("Dervişe Gursoy", "mavi_mudur"), line("Evrim Öztürk", "mavi_asistan", 2330000), line("Dilber Günay", "mavi_asistan"), line("Rojin Arık", "mavi_asistan", null, "left")],
};
const lefkosa: PendingStore = { store_id: "l", store_name: "Mavi Lefkosa", is_mavi: true, revenue: null, target: 9000000, lines: [line("Didem", "mavi_vice")] };
const derimod: PendingStore = { store_id: "d", store_name: "DERIMOD GIRNE", is_mavi: false, revenue: null, target: null, lines: [line("Kaan", "deri_asistan", 500000)] };

const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-10-${String(from + i).padStart(2, "0")}`);

describe("bekleyen belgeler", () => {
  const rows = pendingFor(
    [magusa, lefkosa, derimod],
    [
      {
        store_id: "m",
        docs: [
          { kind: "bi_pdf", file_name: "bi.pdf", pages: { sales: true, category: true } },
          { kind: "kpi_xlsx", file_name: "kpi.xlsx" },
        ],
        daily: { days_expected: 31, days_present: 18, days_missing: days(1, 13) },
      },
      { store_id: "l", docs: [{ kind: "bi_pdf", file_name: "kat.pdf", pages: { sales: false, category: true } }], daily: { days_expected: 31, days_present: 31, days_missing: [] } },
    ]
  );
  const [m, l, d] = rows as [(typeof rows)[0], (typeof rows)[0], (typeof rows)[0]];
  const st = (r: typeof m, k: string) => r.items.find((i) => i.key === k)?.status;

  it("Mağusa: BI + KPI geldi, günlükler kısmi, hedefler eksik; ayrılan sayılmaz", () => {
    expect(st(m, "bi_sales")).toBe("ok");
    expect(st(m, "kpi")).toBe("ok");
    expect(st(m, "itpos")).toBe("optional");
    expect(m.items.find((i) => i.key === "daily")?.detail).toBe("18 / 31 gün · eksik: 1–13");
    expect(st(m, "store_target")).toBe("missing");
    const pt = m.items.find((i) => i.key === "person_targets")!;
    expect(pt.status).toBe("partial");
    expect(pt.detail).toBe("1 / 2 kişi · bekleyen: Dilber Günay");
    expect(m.open).toBe(3);
  });

  it("Lefkoşa: yalnız kategori sayfası geldi → satış sayfası ve KPI bekleniyor", () => {
    expect(st(l, "bi_sales")).toBe("missing");
    expect(st(l, "bi_category")).toBe("ok");
    expect(st(l, "kpi")).toBe("missing");
    expect(st(l, "daily")).toBe("ok");
    expect(st(l, "store_target")).toBe("ok");
    expect(st(l, "person_targets")).toBeUndefined();
  });

  it("Derimod: belge istenmez, Nebim cirosu ve hedefler", () => {
    expect(d.items.map((i) => i.key)).toEqual(["nebim", "person_targets"]);
    expect(st(d, "nebim")).toBe("missing");
    expect(st(d, "person_targets")).toBe("ok");
  });

  it("gönderilecek metin yalnız bekleyenleri içerir", () => {
    const t = pendingText("Ekim 2026", rows);
    expect(t).toContain("Mavi Lefkosa:\n- BI raporu — satış sayfası (Net TL, UPT, tekli işlem)\n- Personel KPI (erkek / kadın denim)");
    expect(t).not.toContain("IT POS");
    expect(t).not.toContain("Rojin");
    expect(pendingText("Ekim 2026", [])).toBe("Ekim 2026 primi için bekleyen belge yok.");
  });

  it("sayaç isteğe bağlıları saymaz", () => {
    expect(pendingCounts([m])).toEqual({ ok: 3, partial: 2, missing: 1, total: 6 });
  });
});
