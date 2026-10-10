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
