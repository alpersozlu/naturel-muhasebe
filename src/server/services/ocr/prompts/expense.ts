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
  "vendor": null, "expense_date": null, "expense_date_raw": null, "amount": null,
  "vat_rate": null, "vat_included": true,
  "category": "other", "description": null, "currency": "TRY"
}

Eğer fatura/makbuz İSE:
{
  "is_expense": true,
  "rejection_reason": null,
  "vendor": "string veya null (faturayı kesen firma adı)",
  "expense_date": "YYYY-MM-DD veya null (fatura tarihi)",
  "expense_date_raw": "belgedeki tarih HARFİYEN, olduğu gibi (örn. \"24,8,26\" veya \"24/08/2026\") veya null",
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

═══════════════════════════════════════════════════════════════
TARİH OKUMA — ÇOK SIK HATA, DİKKAT
═══════════════════════════════════════════════════════════════
Türkiye'de tarih HER ZAMAN GÜN-AY-YIL sırasıyla yazılır. Ayraç nokta, virgül,
eğik çizgi, tire ya da boşluk olabilir; yıl 2 ya da 4 hane olabilir:
    24.08.2026 · 24/8/26 · 24,8,26 · 24-08-26 · 24 Ağustos 2026
Hepsi 24 Ağustos 2026'dır → "2026-08-24".

⚠ İKİ HANELİ YIL: "26" → 2026, "25" → 2025. ASLA ilk grubu yıl sanma.
   "24/8/26" 2024 DEĞİLDİR; gün 24, ay 8, yıl 2026'dır.

⚠ EL YAZISI TARİH: Faturalarda tarih çoğu zaman tükenmez kalemle elle
   yazılmıştır, ayraç olarak virgül/nokta karışık kullanılır. Yine
   GÜN-AY-YIL sırasıdır. Rakamları dikkatle ayır.

expense_date_raw alanına belgede GÖRDÜĞÜN metni, hiç yorumlamadan, olduğu
gibi yaz (ayraçlarıyla, iki haneliyse iki haneli). Bu alan yorumun değil,
belgenin kopyasıdır — sunucu çözümlemeyi kendisi yapar.

Kendini test et: expense_date ile expense_date_raw aynı günü mü anlatıyor?
Bugünden çok uzak (1 yıldan eski / gelecek) bir tarih çıkardıysan büyük
ihtimalle sırayı karıştırdın — GÜN-AY-YIL ile tekrar oku.
- "Sayın" / "Mal Sahibi" / "ÜNVAN" → vendor

═══════════════════════════════════════════════════════════════
NOKTA VURUŞLU (DOT-MATRIX) ÇIKTILARDA RAKAM AYIRT ETME
═══════════════════════════════════════════════════════════════
KKTC'deki birçok toptancı faturası nokta vuruşlu yazıcıdan çıkar ve soluktur.
Bu yazıda rakamlar birbirine çok benzer — en sık karışanlar:
    3 ↔ 8   (8'in sol tarafı kapalıdır, 3'ün açık)
    6 ↔ 5   (6'nın altı kapalı halka, 5'in üstü düz çizgi)
    0 ↔ 8   ·   1 ↔ 7
Bir rakamdan emin değilsen, aynı rakamın belgenin BAŞKA yerindeki yazımıyla
karşılaştır (tarih, fatura no, tutarlar aynı yazı tipindedir).

TARİHTE ÖZELLİKLE DİKKAT: ay ve yıl tek rakam yanlış okununca belge yanlış
güne düşer. "24.08.2026" ile "24.03.2026" arasındaki tek fark bir rakamdır.
Okuduğun tarih bugünden çok uzaksa (gelecekte ya da 1 yıldan eski) muhtemelen
bir rakamı yanlış okudun — o haneye tekrar bak.
`;
