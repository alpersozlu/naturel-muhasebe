import { describe, expect, it } from "vitest";
import { overtimeApplyDecision } from "@/components/payroll/overtime-apply";

/** "uygula" bekleyen kayıtlarla açıklanan fazlalığı düşüremez (06.10.2026, dört müdür). */
describe("mesai önerisi — uygula kararı", () => {
  it("bordro ile Kolay İK aynıysa düğme yok", () => {
    expect(overtimeApplyDecision({ approved_hours: 13, waiting_hours: 0 }, 13)).toEqual({ mode: "same" });
    expect(overtimeApplyDecision({ approved_hours: 13, waiting_hours: 5 }, 13)).toEqual({ mode: "same" });
  });

  it("sahibinin sohbette onayladığı bekleyen saatler bordrodayken uygula düşürmez (Döne 0+13, Adile 2+13, Ayşe 27+14)", () => {
    expect(overtimeApplyDecision({ approved_hours: 0, waiting_hours: 13 }, 13)).toEqual({ mode: "wait", hours_after_approval: 13 });
    expect(overtimeApplyDecision({ approved_hours: 2, waiting_hours: 13 }, 13)).toEqual({ mode: "wait", hours_after_approval: 15 });
    expect(overtimeApplyDecision({ approved_hours: 27, waiting_hours: 14 }, 14)).toEqual({ mode: "wait", hours_after_approval: 41 });
    expect(overtimeApplyDecision({ approved_hours: 0, waiting_hours: 3.5 }, 3.5)).toEqual({ mode: "wait", hours_after_approval: 3.5 });
  });

  it("Kolay İK'da onaylanınca normal öneri: önceden onaylı saatler de eklenir", () => {
    expect(overtimeApplyDecision({ approved_hours: 15, waiting_hours: 0 }, 13)).toEqual({ mode: "apply", hours: 15 });
    expect(overtimeApplyDecision({ approved_hours: 41, waiting_hours: 0 }, 14)).toEqual({ mode: "apply", hours: 41 });
  });

  it("bekleyenle açıklanamayan fazlalık ya da eksiklik eskisi gibi uygulanır", () => {
    // bordroda 20 var, onaylı 2, bekleyen 13 → 20 > 15: bekleyenle açıklanmıyor, öneri 2
    expect(overtimeApplyDecision({ approved_hours: 2, waiting_hours: 13 }, 20)).toEqual({ mode: "apply", hours: 2 });
    // bordroda az: öneri yükseltir
    expect(overtimeApplyDecision({ approved_hours: 7.5, waiting_hours: 0 }, 0)).toEqual({ mode: "apply", hours: 7.5 });
    // reddedilen kayıt: onaylı düştü, bekleyen yok → düşürme meşru
    expect(overtimeApplyDecision({ approved_hours: 5, waiting_hours: 0 }, 9)).toEqual({ mode: "apply", hours: 5 });
  });
});
