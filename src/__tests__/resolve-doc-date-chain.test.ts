import { describe, expect, it } from "vitest";
import { balancesChain } from "@/server/services/ocr/resolve-doc-date";

describe("Nebim özeti kasa zinciri", () => {
  it("önceki günün Yarına Devri = bu özetin Önceki Günden Devri (Lefkoşa 08→09.10.2026)", () => {
    expect(balancesChain(22_836_974.04, 22_836_974.04)).toBe(true);
    expect(balancesChain(22_836_974.04, 22_836_974.05)).toBe(true); // yuvarlama
    expect(balancesChain(22_836_974.04, 22_836_975.04)).toBe(false);
    expect(balancesChain(null, 22_836_974.04)).toBe(false);
    expect(balancesChain(0, 0)).toBe(false); // sıfır bakiye kanıt değil
  });
});

describe("Nebim özeti tarihi yalnız alt satırdan (23.10.2026)", () => {
  it("'Başlangıç Tarihi = …, Bitiş Tarihi = …' satırını çözer", async () => {
    const { nebimPeriodFromFooter } = await import("@/server/services/ocr/resolve-doc-date");
    expect(nebimPeriodFromFooter("Başlangıç Tarihi = 22.10.2026, Bitiş Tarihi = 22.10.2026")).toEqual({ start: "2026-10-22", end: "2026-10-22" });
    expect(nebimPeriodFromFooter("Baslangic Tarihi: 19.05.2026 Bitis Tarihi: 20.05.2026")).toEqual({ start: "2026-05-19", end: "2026-05-20" });
    expect(nebimPeriodFromFooter("Lefkoşa Kasa | 22 Ekim 2026")).toBeNull(); // durum çubuğu — tarih kaynağı değil
    expect(nebimPeriodFromFooter("22 Ekim 2026 Perşembe")).toBeNull(); // yazdırma tarihi
    expect(nebimPeriodFromFooter(null)).toBeNull();
  });
});
