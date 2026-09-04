/**
 * Mağaza çalışma takvimi (Derimod).
 *
 * Derimod Mağusa (S02, City Mall) PAZAR GÜNLERİ KAPALIDIR — kullanıcı
 * 2026-09-04'te net söyledi: "pazarları Derimod Mağusa'yı hep kapalı bil; açık
 * olacağı bir pazar olursa onu ben söylerim." O gün Nebim'de satır olmaması,
 * özet/POS/Z yüklenmemesi NORMALDİR. Lefkoşa ve Girne pazar günü açıktır
 * (Nebim'de 35 / 23 pazar satış günü var).
 *
 * Neden burada: ay-sonu tahmini takvim gününe göre çarpınca Mağusa'da
 * pazarlar sıfır olduğu için ay başında %10'a kadar şişiyordu. Çalışma günü
 * bazlı projeksiyon bunu düzeltir. Günlük ortalama (analytics/revenue) zaten
 * yalnız veri olan günlere böldüğü için etkilenmez.
 *
 * Açık pazar istisnası: kullanıcı söylediğinde tarihi OPEN_EXCEPTIONS'a ekle.
 * İlk iki tarih veriden geldi — Nebim'de o pazarlarda satış var (15.03.2026
 * 24.204,98 · 24.05.2026 41.899,92), yani mağaza o günler açıkmış.
 */

/** Haftanın kapalı günleri, JS getUTCDay() sırasıyla (0 = Pazar). */
export const CLOSED_WEEKDAYS: Record<string, readonly number[]> = {
  S02: [0],
};

/** Kapalı hafta gününe denk gelse de AÇIK olan tarihler (YYYY-MM-DD). */
export const OPEN_EXCEPTIONS: Record<string, readonly string[]> = {
  S02: ["2026-03-15", "2026-05-24"],
};

/**
 * Mağaza adından Nebim kodu (S01/S02/S03). Nebim satırı yoksa (örn. ay
 * başında hiç satış olmayan mağaza) `nebim_store_code` da olmaz; ad her
 * zaman vardır. Tanınmayan ad → null (takvim kısıtı uygulanmaz).
 */
export function storeCodeFromName(name: string): string | null {
  const n = name.toLocaleLowerCase("tr").replace(/ı/g, "i");
  // Mavi mağazaları da aynı şehir adlarını taşır; takvim yalnız Derimod'a ait.
  if (n.includes("mavi")) return null;
  if (n.includes("lefkosa")) return "S01";
  if (n.includes("magusa")) return "S02";
  if (n.includes("girne")) return "S03";
  return null;
}

/** Mağaza o gün açık mı? Tarih UTC gece yarısı (DB @db.Date ile aynı). */
export function isStoreOpen(code: string | null, date: Date): boolean {
  if (!code) return true;
  const closed = CLOSED_WEEKDAYS[code];
  if (!closed || !closed.includes(date.getUTCDay())) return true;
  const iso = date.toISOString().slice(0, 10);
  return (OPEN_EXCEPTIONS[code] ?? []).includes(iso);
}

/**
 * Ayın 1'inden `throughDay` dahil o güne kadar kaç ÇALIŞMA günü var?
 * `throughDay` = ayın gün sayısı → ayın toplam çalışma günü.
 */
export function openDaysInMonth(
  code: string | null,
  year: number,
  month: number, // 1–12
  throughDay: number
): number {
  let n = 0;
  for (let d = 1; d <= throughDay; d++) {
    if (isStoreOpen(code, new Date(Date.UTC(year, month - 1, d)))) n++;
  }
  return n;
}
