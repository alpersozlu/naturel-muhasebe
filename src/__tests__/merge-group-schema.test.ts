import { describe, expect, it } from "vitest";
import { mergeGroupCreateSchema } from "@/lib/zod-schemas/merge-group";

const store_id = "11111111-1111-4111-8111-111111111111";

describe("gün birleşmesi: seçili günler", () => {
  it("1-3-5 Ekim ardışık olmadan birleşir", () => {
    const v = mergeGroupCreateSchema.parse({ store_id, start_date: "2026-10-01", end_date: "2026-10-05", dates: ["2026-10-05", "2026-10-01", "2026-10-03"] });
    expect(v.dates).toHaveLength(3);
  });
  it("seçili günlerde başlangıç/bitiş ilk ve son gün olmalı, tekrar olamaz, en fazla 3", () => {
    expect(() => mergeGroupCreateSchema.parse({ store_id, start_date: "2026-10-01", end_date: "2026-10-06", dates: ["2026-10-01", "2026-10-05"] })).toThrow();
    expect(() => mergeGroupCreateSchema.parse({ store_id, start_date: "2026-10-01", end_date: "2026-10-03", dates: ["2026-10-01", "2026-10-01", "2026-10-03"] })).toThrow();
    expect(() => mergeGroupCreateSchema.parse({ store_id, start_date: "2026-10-01", end_date: "2026-10-07", dates: ["2026-10-01", "2026-10-03", "2026-10-05", "2026-10-07"] })).toThrow();
  });
  it("aralık modu eskisi gibi: en çok 3 ardışık gün", () => {
    expect(mergeGroupCreateSchema.parse({ store_id, start_date: "2026-10-01", end_date: "2026-10-03" }).dates).toBeUndefined();
    expect(() => mergeGroupCreateSchema.parse({ store_id, start_date: "2026-10-01", end_date: "2026-10-05" })).toThrow();
  });
});
