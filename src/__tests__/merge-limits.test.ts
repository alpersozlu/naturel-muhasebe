import { describe, expect, it } from "vitest";
import { MERGE_DAYS_DEFAULT, MERGE_DAYS_MAX, maxMergeDays, mergeLimitMessage } from "@/lib/merge-limits";
import { mergeGroupCreateSchema } from "@/lib/zod-schemas/merge-group";

const STORE = "11111111-1111-4111-8111-111111111111";

describe("gün birleşmesi sınırı mağazaya göre", () => {
  it("Derimod Lefkoşa 4 gün; yazım farkları eşleşmeyi bozmaz", () => {
    for (const n of ["DERIMOD LEFKOSA", "Derimod Lefkoşa", "derimod lefkosa", " Derimod  LEFKOŞA "]) {
      expect(maxMergeDays(n)).toBe(4);
    }
  });

  it("diğer mağazalar 3 günde kalır", () => {
    for (const n of ["DERIMOD GIRNE", "DERIMOD MAGUSA", "Mavi Lefkosa", "Mavi Guzelyurt", "", null, undefined]) {
      expect(maxMergeDays(n)).toBe(MERGE_DAYS_DEFAULT);
    }
    expect(MERGE_DAYS_DEFAULT).toBe(3);
    expect(MERGE_DAYS_MAX).toBe(4);
  });

  it("mesaj sınırı söyler", () => {
    expect(mergeLimitMessage(4)).toBe("En fazla 4 gün birleştirilebilir.");
  });

  describe("şema üst sınırı en geniş mağazanınki (mağaza kuralını sunucu uygular)", () => {
    const range = (start: string, end: string) => mergeGroupCreateSchema.safeParse({ store_id: STORE, start_date: start, end_date: end });
    it("4 günlük ardışık aralık şemadan geçer", () => {
      expect(range("2026-11-10", "2026-11-13").success).toBe(true);
    });
    it("5 gün geçmez", () => {
      const r = range("2026-11-10", "2026-11-14");
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]!.message).toContain("en fazla 4 gün");
    });
    it("tek gün geçmez", () => {
      expect(range("2026-11-10", "2026-11-10").success).toBe(false);
    });
    it("seçili günlerde de 4'e kadar", () => {
      const ok = mergeGroupCreateSchema.safeParse({ store_id: STORE, start_date: "2026-11-10", end_date: "2026-11-14", dates: ["2026-11-10", "2026-11-12", "2026-11-13", "2026-11-14"] });
      expect(ok.success).toBe(true);
      const no = mergeGroupCreateSchema.safeParse({ store_id: STORE, start_date: "2026-11-10", end_date: "2026-11-14", dates: ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"] });
      expect(no.success).toBe(false);
    });
  });
});
