import { describe, expect, it } from "vitest";
import { matchCorporateToInvoices } from "@/server/services/nebim/corporate-check";

const inv = (ref: string, name: string | null, net: number) => ({ invoice_ref: ref, customer_name: name, net, date: "2026-10-15" });

describe("Derimod kurumsal alışveriş ↔ Nebim fişi", () => {
  it("Mert Ersözlü 36.500 = iki fişin net toplamı (26.000 + 10.500)", () => {
    const r = matchCorporateToInvoices({ person_name: "Mert ersozlu", company_name: null, amount_try: 36_500 }, [inv("1-R-7-94725", "MERT ERSÖZLÜ", 26_000), inv("1-R-7-94730", "MERT ERSÖZLÜ", 10_500), inv("1-R-7-94736", "SİNEM D.", 4_999.99)]);
    expect(r.status).toBe("match");
    expect(r.invoice_refs).toEqual(["1-R-7-94725", "1-R-7-94730"]);
  });
  it("Mine Ersözlü 12.692 ↔ 12.691,98 (kuruş toleransı)", () => {
    const r = matchCorporateToInvoices({ person_name: "Mine Ersözlü", company_name: null, amount_try: 12_692 }, [inv("1-R-7-94587", "MİNE ERSÖZLÜ", 12_691.98)]);
    expect(r.status).toBe("match");
  });
  it("isim var tutar tutmuyor → amount_mismatch; alt küme tutuyorsa match", () => {
    const r = matchCorporateToInvoices({ person_name: "Mert Ersözlü", company_name: null, amount_try: 30_000 }, [inv("a", "MERT ERSÖZLÜ", 26_000), inv("b", "MERT ERSÖZLÜ", 10_500)]);
    expect(r.status).toBe("amount_mismatch");
    expect(r.nebim_net).toBe(36_500);
    const s = matchCorporateToInvoices({ person_name: "Mert Ersözlü", company_name: null, amount_try: 26_000 }, [inv("a", "MERT ERSÖZLÜ", 26_000), inv("b", "MERT ERSÖZLÜ", 10_500)]);
    expect(s.status).toBe("match");
    expect(s.invoice_refs).toEqual(["a"]);
  });
  it("isim yok → not_found; aynı tutarda isimsiz fiş ipucu", () => {
    const r = matchCorporateToInvoices({ person_name: "Kaner Ltd", company_name: "Kaner", amount_try: 5_000 }, [inv("x", null, 5_000), inv("y", "AYŞE", 7_000)]);
    expect(r.status).toBe("not_found");
    expect(r.amount_only_ref).toBe("x");
  });
});
