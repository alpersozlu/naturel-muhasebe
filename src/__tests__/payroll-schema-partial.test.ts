import { describe, expect, it } from "vitest";
import { employeeUpdateSchema, lineUpdateSchema } from "@/lib/zod-schemas/payroll";

// 02.11.2026: yalnız hedefi güncelleyen istek satır notunu / komisyon notunu / ek prim
// notunu sessizce siliyordu (gönderilmeyen metin alanı null'a çevriliyordu).
const ID = "11111111-1111-4111-8111-111111111111";

describe("kısmi güncelleme gönderilmeyen alanlara dokunmaz", () => {
  it("bordro satırı: yalnız hedef gönderilince not alanları undefined kalır", () => {
    const v = lineUpdateSchema.parse({ id: ID, own_target: 2065000 });
    expect(v.own_target).toBe(2065000);
    for (const f of ["note", "commission_note", "overtime_note", "extra_premium_note"] as const) expect(v[f]).toBeUndefined();
  });
  it("satırın komisyon profili tek başına güncellenebilir (pasiften aktife geçen satış asistanı)", () => {
    const v = lineUpdateSchema.parse({ id: ID, commission_profile: "mavi_asistan" });
    expect(v.commission_profile).toBe("mavi_asistan");
    expect(v.note).toBeUndefined();
    expect(lineUpdateSchema.safeParse({ id: ID, commission_profile: "yok" }).success).toBe(false);
  });
  it("boş metin alanı açıkça boşaltır, dolu metin kırpılır", () => {
    const v = lineUpdateSchema.parse({ id: ID, note: "", commission_note: "  ÖZEL  " });
    expect(v.note).toBeNull();
    expect(v.commission_note).toBe("ÖZEL");
  });
  it("personel: IBAN ve notlar gönderilmezse undefined; boş IBAN null; IBAN biçimi denetlenir", () => {
    const v = employeeUpdateSchema.parse({ id: ID, aliases: ["X"] });
    expect(v.iban).toBeUndefined();
    expect(v.notes).toBeUndefined();
    expect(employeeUpdateSchema.parse({ id: ID, iban: "" }).iban).toBeNull();
    expect(employeeUpdateSchema.parse({ id: ID, iban: "tr12 0006 2000 0000 0000 0000 00" }).iban).toBe("TR120006200000000000000000");
    expect(employeeUpdateSchema.safeParse({ id: ID, iban: "TR12" }).success).toBe(false);
  });
});
