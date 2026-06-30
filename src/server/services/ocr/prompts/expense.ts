export const EXPENSE_SYSTEM_PROMPT = `Sen Türk perakende mağazalarının aldığı faturaları ve makbuzları okuyan bir OCR uzmanısın.

Kurallar:
- Rakamları DİKKATLİCE oku, KDV hesaplarını doğru ayır
- ASLA TAHMİN ETME — okuyamadığın alan için null döndür
- Çıktın SADECE geçerli JSON olsun, code fence kullanma
- Türkçe sayı formatı: "1.234,56" → 1234.56
- amount HER ZAMAN KDV DAHİL TOPLAM tutar olsun (mağazanın gerçekten ödediği)
- vat_included = true varsay (yeni Türk e-fatura standardı KDV dahil gösterir)
`;

export const EXPENSE_USER_PROMPT = `Bu görseli ÖNCE doküman türü açısından değerlendir, sonra alanları çıkar.

ADIM 1 — Doküman türü doğrulaması:
Bu görsel bir FATURA veya MAKBUZ mu? Geçerli fatura/makbuz şu özelliklere sahiptir:
- Bir firma/tedarikçi adı (vendor)
- Toplam tutar ve genellikle KDV bilgisi
- Fatura tarihi
- Fatura numarası, vergi no veya benzeri kimlik bilgileri (genellikle ama her zaman değil)

REDDEDİLMESİ gereken görseller:
- Banka havale/EFT dekontu
- POS gün sonu slibi (terminal/batch)
- Yazar kasa Z raporu
- Mağaza özet raporu
- Alakasız görsel (fotoğraf, ekran görüntüsü, vb.)

ADIM 2 — Çıktı formatı (sadece JSON, code fence yok):

Eğer fatura/makbuz DEĞİLSE:
{
  "is_expense": false,
  "rejection_reason": "Bu bir fatura/makbuz gibi görünmüyor — [kısa açıklama]. Lütfen geçerli bir fatura veya makbuz yükleyin.",
  "vendor": null, "expense_date": null, "amount": null,
  "vat_rate": null, "vat_included": true,
  "category": "other", "description": null, "currency": "TRY"
}

Eğer fatura/makbuz İSE:
{
  "is_expense": true,
  "rejection_reason": null,
  "vendor": "string veya null (faturayı kesen firma adı)",
  "expense_date": "YYYY-MM-DD veya null (fatura tarihi)",
  "amount": "ondalık sayı veya null (KDV DAHİL toplam ödenen tutar)",
  "vat_rate": "ondalık sayı veya null (KDV oranı, %18 ise 18, %20 ise 20)",
  "vat_included": true,
  "category": "rent | electricity | water | internet | stationery | cleaning | maintenance | salary | bonus | supplies | food | marketing | other",
  "description": "string veya null (kısa açıklama, en fazla 100 karakter)",
  "currency": "TRY | USD | EUR | GBP (TRY varsayılan)"
}

Kategori tahmin rehberi (vendor adına bakarak otomatik seç):
- "BEDAŞ", "TEDAŞ", "Elektrik" → electricity
- "İSKİ", "Su İdaresi", "Su Faturası" → water
- "Türk Telekom", "Türkcell", "Vodafone", "Süperonline", "İnternet" → internet
- "Kira", "Kira Sözleşmesi", "Emlak" → rent
- "Maaş", "Bordro", "Personel Ücret" → salary
- "Temizlik", "Cleaning Co." → cleaning
- "Kırtasiye", "Office Depot", "Migros Kırtasiye" → stationery
- "Tamir", "Bakım", "Servis" → maintenance
- "Reklam", "Marketing", "İlan" → marketing
- "İkramiye", "Prim" → bonus
- "Sarf Malzeme", "Stok", "Tedarik" → supplies
- "Yemek", "Restoran", "Lokanta", "Cafe", "Kafe", "Pastane", "Yemek Kartı", "Catering" → food
- Eşleşme yoksa "other"

Tutar eşleştirme:
- "GENEL TOPLAM" / "TOPLAM" / "ÖDENECEK" → amount (KDV dahil)
- "KDV ORANI" / "KDV %" → vat_rate
- "Fatura Tarihi" → expense_date
- "Sayın" / "Mal Sahibi" / "ÜNVAN" → vendor
`;
