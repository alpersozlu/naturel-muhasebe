/**
 * Deploy sonrası açık kalan sekmelerde, eski sayfa yeni deploy'da artık
 * bulunmayan JS/CSS parçalarını (chunk) istediğinde fırlatılan hatayı tanır.
 * Bu bir kod bug'ı değil; sayfayı yenilemek çözer.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: string }).name ?? "";
  const message = (error as { message?: string }).message ?? "";
  return (
    name === "ChunkLoadError" ||
    /Loading chunk .+ failed/i.test(message) ||
    /Loading CSS chunk/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message)
  );
}

/**
 * Chunk hatasında sayfayı bir kez otomatik yeniler. sessionStorage guard'ı
 * sonsuz reload döngüsünü önler (yeni deploy gerçekten erişilebilir değilse).
 * @returns reload tetiklendiyse true (UI hata göstermesine gerek yok)
 */
export function tryRecoverFromChunkError(error: unknown): boolean {
  if (typeof window === "undefined" || !isChunkLoadError(error)) return false;
  const KEY = "__chunk_reload_at__";
  try {
    const last = Number(window.sessionStorage.getItem(KEY) ?? "0");
    // Son 10 sn içinde zaten yenilediyse tekrar deneme (loop koruması)
    if (Date.now() - last < 10_000) return false;
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // sessionStorage erişilemezse yine de bir kez yenilemeyi dene
  }
  window.location.reload();
  return true;
}
