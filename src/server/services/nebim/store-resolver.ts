/**
 * NEBIM mağaza adını/kodunu DocuFlow'daki Derimod mağazasına eşler.
 * Türkçe karakterleri sadeleştirip (ş→s, ğ→g, ı→i, ...) şehir adına göre
 * eşleştirir. Örn "Girne Mağaza" → "DERIMOD GIRNE" (city: "Girne").
 * Eşleşme bulunamazsa null döner; satır yine de ham adıyla saklanır.
 */

type StoreLite = { id: string; name: string; city: string | null };

export function foldTr(s: string): string {
  return s
    .replace(/[İI]/g, "i")
    .replace(/ı/g, "i")
    .replace(/[Şş]/g, "s")
    .replace(/[Ğğ]/g, "g")
    .replace(/[Üü]/g, "u")
    .replace(/[Öö]/g, "o")
    .replace(/[Çç]/g, "c")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function buildStoreResolver(stores: StoreLite[]) {
  // Her mağaza için eşleşme anahtarı: şehir (yoksa isim).
  const keyed = stores
    .map((s) => ({ id: s.id, key: foldTr(s.city || s.name || "") }))
    .filter((k) => k.key.length > 0);

  return (raw: string | null | undefined): string | null => {
    const r = foldTr(raw || "");
    if (!r) return null;
    for (const k of keyed) {
      if (r.includes(k.key) || k.key.includes(r)) return k.id;
    }
    return null;
  };
}
