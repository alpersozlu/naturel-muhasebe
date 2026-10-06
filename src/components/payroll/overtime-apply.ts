/**
 * "uygula" düğmesinin kararı (Prim ve mesai girişi, Kolay İK mesai önerisi).
 *
 * Öneri = Kolay İK'daki ONAYLI ödenecek saat. Sahibi bekleyen (onaylanmamış)
 * kayıtları sohbette onaylayıp bordroya yazdırabiliyor (06.10.2026, dört
 * müdür). O durumda bordrodaki saat Kolay İK'daki onaylı saatten BÜYÜKTÜR ve
 * "uygula" saatleri düşürürdü. Bekleyen kayıtlar farkı açıklıyorsa düğme
 * çıkmaz; Kolay İK'da onaylanıp panel yenilenince öneri bordroyla eşitlenir
 * ya da önceden onaylı saatler de eklenir.
 */
export type OvertimeSuggestion = { approved_hours: number; waiting_hours: number };

export type ApplyDecision =
  | { mode: "same" }
  | { mode: "apply"; hours: number }
  | { mode: "wait"; hours_after_approval: number };

export function overtimeApplyDecision(ot: OvertimeSuggestion, current: number): ApplyDecision {
  const eps = 0.001;
  if (Math.abs(ot.approved_hours - current) < eps) return { mode: "same" };
  // Bordrodaki saat bekleyen kayıtlarla açıklanıyor (tam bekleyen kadar, ya da
  // onaylı + bekleyenin bir kısmı): üstüne yazma, Kolay İK onayını bekle.
  const pendingOnly = Math.abs(current - ot.waiting_hours) < eps;
  const withinPending = current > ot.approved_hours + eps && current <= ot.approved_hours + ot.waiting_hours + eps;
  if (ot.waiting_hours > eps && (pendingOnly || withinPending)) {
    return { mode: "wait", hours_after_approval: Math.round((ot.approved_hours + ot.waiting_hours) * 100) / 100 };
  }
  return { mode: "apply", hours: ot.approved_hours };
}
