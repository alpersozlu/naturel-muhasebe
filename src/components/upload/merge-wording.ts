/**
 * BİRLEŞİK GÜNLERDE MAĞAZA ÖZETİ YALNIZ SON GÜNDE İSTENİR.
 *
 * Kasa bir gün kapatılamazsa (Mavi Güzelyurt 01.10.2026: kapanıştan önce
 * elektrik kesildi) o günün mağaza özeti hiç olmaz; günler tek özetle birlikte
 * kapanır ve özet SON güne yüklenir. Uzlaşma paneli eskiden grubun ilk gününde
 * de "Eksik: Mağaza Özeti" yazıyordu — sahibi, 05.10.2026: "sistemin 1 Ekim
 * için mağaza özeti sormaması gerekiyor". Bu dosya panelin o metinlerini üretir
 * (saf, testli).
 */
export type MergeCtx =
  | { start_date: string; end_date: string; day_count: number; is_last_day: boolean }
  | null
  | undefined;

type Fmt = (iso: string) => string;

/** Bu sayfada (bu günde) mağaza özeti beklenmiyor mu? Birleşik grubun son günü dışındaki günler. */
export function summaryWaivedHere(merge: MergeCtx, hasSummary: boolean): boolean {
  return !!merge && !merge.is_last_day && !hasSummary;
}

/** Kontrol listesindeki "Mağaza Özeti" satırı. */
export function summaryCheck(merge: MergeCtx, hasSummary: boolean, fmt: Fmt): { label: string; waived: boolean } {
  if (!merge) return { label: "Mağaza Özeti", waived: false };
  if (hasSummary) return { label: `Mağaza Özeti (${merge.day_count} günü kapsar)`, waived: false };
  if (merge.is_last_day) return { label: `Mağaza Özeti (${merge.day_count} günü kapsayan özet bu güne yüklenir)`, waived: false };
  return { label: `Mağaza Özeti bu gün istenmez — ${fmt(merge.end_date)} gününe yüklenir`, waived: true };
}

/**
 * "Eksik var" bildirimi. `missing` özet DIŞINDAKİ eksiklerdir (Z, POS, nakit
 * kaynağı — birleşik günlerde grubun tamamı için sayılır).
 */
export function incompleteNotice(a: {
  merge: MergeCtx;
  has_summary: boolean;
  missing: string[];
  fmt: Fmt;
}): { tone: "amber" | "slate"; title: string; message: string } {
  const { merge, has_summary, missing, fmt } = a;
  if (summaryWaivedHere(merge, has_summary)) {
    const end = fmt(merge!.end_date);
    const rest = missing.length > 0 ? ` Birleşik günlerde ayrıca eksik: ${missing.join(", ")}.` : "";
    return {
      tone: missing.length > 0 ? "amber" : "slate",
      title: "Bu gün için mağaza özeti istenmez",
      message:
        `Bu gün ${end} ile birlikte kapanacak (kasa birleşmesi). Mağaza özeti ve bayi gün sonu dosyası ` +
        `${end} gününe yüklenir ve günlerin hepsini kapsar; mutabakat o zaman hesaplanır.${rest}`,
    };
  }
  const all = has_summary
    ? missing
    : [merge ? `Mağaza Özeti (${fmt(merge.start_date)} – ${fmt(merge.end_date)} günlerini birlikte kapsayan özet bu güne yüklenir)` : "Mağaza Özeti", ...missing];
  return {
    tone: "amber",
    title: "Eksik var",
    message: all.length > 0 ? `Eksik: ${all.join(", ")}. Bunlar yüklenince mutabakat hesaplanır.` : "Mutabakat için zorunlu kalemler tamamlanmalı.",
  };
}
