import { describe, expect, it } from "vitest";
import { incompleteNotice, summaryCheck, summaryWaivedHere } from "@/components/upload/merge-wording";
import { priorDayLockMessage } from "@/server/services/daily-record";

/**
 * Birleşik günlerde mağaza özeti yalnız SON günde istenir (Mavi Güzelyurt
 * 01–02.10.2026; sahibi 05.10.2026: "sistemin 1 Ekim için mağaza özeti
 * sormaması gerekiyor").
 */
const fmt = (iso: string) => iso.split("-").reverse().join(".");
const group = (is_last_day: boolean) => ({ start_date: "2026-10-01", end_date: "2026-10-02", day_count: 2, is_last_day });

describe("birleşik günlerde mağaza özeti", () => {
  it("birleşme yokken eski davranış: özet eksikse istenir", () => {
    expect(summaryWaivedHere(null, false)).toBe(false);
    expect(summaryCheck(null, false, fmt)).toEqual({ label: "Mağaza Özeti", waived: false });
    const n = incompleteNotice({ merge: null, has_summary: false, missing: [], fmt });
    expect(n).toEqual({ tone: "amber", title: "Eksik var", message: "Eksik: Mağaza Özeti. Bunlar yüklenince mutabakat hesaplanır." });
  });

  it("birleşmenin İLK gününde özet istenmez; nereye yükleneceği yazar", () => {
    expect(summaryWaivedHere(group(false), false)).toBe(true);
    expect(summaryCheck(group(false), false, fmt)).toEqual({
      label: "Mağaza Özeti bu gün istenmez — 02.10.2026 gününe yüklenir",
      waived: true,
    });
    const n = incompleteNotice({ merge: group(false), has_summary: false, missing: [], fmt });
    expect(n.tone).toBe("slate");
    expect(n.title).toBe("Bu gün için mağaza özeti istenmez");
    expect(n.message).toContain("02.10.2026 ile birlikte kapanacak");
    expect(n.message).not.toContain("Eksik: Mağaza Özeti");
  });

  it("ilk günde başka eksik varsa (Z, POS) o yine söylenir, özet yine istenmez", () => {
    const n = incompleteNotice({ merge: group(false), has_summary: false, missing: ["Z Raporu veya El Faturası", "POS Fişi"], fmt });
    expect(n.tone).toBe("amber");
    expect(n.title).toBe("Bu gün için mağaza özeti istenmez");
    expect(n.message).toContain("Birleşik günlerde ayrıca eksik: Z Raporu veya El Faturası, POS Fişi.");
  });

  it("birleşmenin SON gününde özet istenir ve iki günü kapsadığı yazar", () => {
    expect(summaryWaivedHere(group(true), false)).toBe(false);
    expect(summaryCheck(group(true), false, fmt)).toEqual({ label: "Mağaza Özeti (2 günü kapsayan özet bu güne yüklenir)", waived: false });
    const n = incompleteNotice({ merge: group(true), has_summary: false, missing: [], fmt });
    expect(n.tone).toBe("amber");
    expect(n.title).toBe("Eksik var");
    expect(n.message).toBe(
      "Eksik: Mağaza Özeti (01.10.2026 – 02.10.2026 günlerini birlikte kapsayan özet bu güne yüklenir). Bunlar yüklenince mutabakat hesaplanır."
    );
  });

  it("özet yüklendikten sonra hiçbir günde 'istenmez' denmez; kalan eksikler sıralanır", () => {
    for (const last of [true, false]) {
      expect(summaryWaivedHere(group(last), true)).toBe(false);
      expect(summaryCheck(group(last), true, fmt)).toEqual({ label: "Mağaza Özeti (2 günü kapsar)", waived: false });
      const n = incompleteNotice({ merge: group(last), has_summary: true, missing: ["Nakit Kaynağı (Sayım / Dekont / Hediye / Masraf)"], fmt });
      expect(n.title).toBe("Eksik var");
      expect(n.message).toBe("Eksik: Nakit Kaynağı (Sayım / Dekont / Hediye / Masraf). Bunlar yüklenince mutabakat hesaplanır.");
    }
  });

  it("üç günlük birleşmede ilk iki gün de özet istemez", () => {
    const g3 = { start_date: "2026-10-01", end_date: "2026-10-03", day_count: 3, is_last_day: false };
    expect(summaryCheck(g3, false, fmt).label).toBe("Mağaza Özeti bu gün istenmez — 03.10.2026 gününe yüklenir");
    expect(incompleteNotice({ merge: g3, has_summary: false, missing: [], fmt }).message).toContain("03.10.2026 gününe yüklenir");
  });
});


describe("kilit kapısı mesajı — özetsiz gün", () => {
  it("Mavi'de açık günün özeti yoksa çıkış yolu (ertesi günle birlikte kapanış) söylenir", () => {
    const m = priorDayLockMessage({ day: "01.10.2026", isMavi: true, hasSummary: false });
    expect(m).toContain("Önce 01.10.2026 gününü kilitlemelisin.");
    expect(m).toContain('"Bu günün özeti yok — ertesi günle kapanacak"');
  });

  it("özeti olan günde ve Derimod'da mesaj eskisi gibi", () => {
    const plain = priorDayLockMessage({ day: "01.10.2026", isMavi: true, hasSummary: true });
    expect(plain).not.toContain("Kasa Birleşmesi");
    expect(priorDayLockMessage({ day: "01.10.2026", isMavi: false, hasSummary: false })).toBe(plain);
  });
});
