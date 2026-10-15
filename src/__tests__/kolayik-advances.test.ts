import { describe, expect, it } from "vitest";
import { matchAdvances } from "@/server/services/kolayik/payroll-sync";

const k = (id: string, emp: string | null, amount: number, name = "X") => ({ id, employee_id: emp, person_name: name, amount, date: "2026-09-14", status: "approved", paid: false, affect_payroll: false, description: null });
const p = (id: string, emp: string, amount: number, channel = "garanti") => ({ id, employee_id: emp, full_name: emp, amount, date: "2026-09-16", channel });

describe("Kolay İK avans talepleri ↔ bordro avansları", () => {
  it("aynı tutar → exact; farklı tutar → amount_diff; talebi yok → none; yalnız bordroda", () => {
    const r = matchAdvances(
      [k("k1", "maral", 25_000), k("k2", "bagtyyar", 18_000), k("k3", "oguz", 45_000), k("k4", null, 50_000, "Dervişe Rızza")],
      [p("p1", "maral", 25_000), p("p2", "bagtyyar", 10_000), p("p3", "kaan", 60_000, "cash")]
    );
    const by = Object.fromEntries(r.advances.map((a) => [a.id, a]));
    expect(by.k1!.match).toBe("exact");
    expect(by.k2!.match).toBe("amount_diff");
    expect(by.k2!.payroll_amount).toBe(10_000);
    expect(by.k3!.match).toBe("none");
    expect(by.k4!.match).toBe("none"); // bordroda eşleşmeyen kişi
    expect(r.only_in_payroll.map((x) => x.employee_id)).toEqual(["kaan"]);
  });
  it("aynı kişide iki talep iki kayıt: önce tam tutarlar eşlenir, kayıt iki kez kullanılmaz", () => {
    const r = matchAdvances([k("a", "e", 20_000), k("b", "e", 5_000)], [p("x", "e", 5_000), p("y", "e", 20_000)]);
    expect(r.advances.every((a) => a.match === "exact")).toBe(true);
    expect(r.only_in_payroll).toHaveLength(0);
  });
});
