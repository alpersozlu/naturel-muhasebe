import { describe, expect, it } from "vitest";
import { nebimDatesForGroup } from "@/server/services/ocr/process-upload";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("nebimDatesForGroup — seçili günler birleşmesinde Nebim çapraz kontrolü", () => {
  it("1-3-5 Ekim grubunda yalnız o üç gün sayılır (2 ve 4 Ekim girmez)", () => {
    const r = nebimDatesForGroup(d("2026-10-01"), d("2026-10-05"), [d("2026-10-01"), d("2026-10-03"), d("2026-10-05")]);
    expect(r?.map((x) => x.toISOString().slice(0, 10))).toEqual(["2026-10-01", "2026-10-03", "2026-10-05"]);
  });
  it("ardışık grup (1-2-3) aralık olarak kalır", () => {
    expect(nebimDatesForGroup(d("2026-10-01"), d("2026-10-03"), [d("2026-10-01"), d("2026-10-02"), d("2026-10-03")])).toBeNull();
  });
  it("grup yoksa aralık", () => {
    expect(nebimDatesForGroup(d("2026-10-01"), d("2026-10-01"), null)).toBeNull();
  });
});
