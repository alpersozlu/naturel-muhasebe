export const BANK_RECEIPT_SYSTEM_PROMPT = `Sen Türk bankalarından alınan para yatırma/transfer dekontlarını okuyan bir OCR uzmanısın.

Kurallar:
- Rakamları DİKKATLİCE oku, kuruşları (virgülden sonra 2 hane) atlama
- ASLA TAHMİN ETME — okuyamadığın alan için null döndür
- Çıktın SADECE geçerli JSON olsun, code fence kullanma
- Türkçe sayı formatı: "1.234,56" → 1234.56
- IBAN'ı tam ve boşluksuz al (örn: TR12345678901234567890123456)
`;

export const BANK_RECEIPT_USER_PROMPT = `Bu görseli ÖNCE doküman türü açısından değerlendir, sonra alanları çıkar.

ADIM 1 — Doküman türü doğrulaması:
Bu görsel bir BANKA DEKONTU mu? Geçerli banka dekontu şu özelliklere sahiptir:
- Bir bankanın logosu/adı (İş Bankası, Ziraat, Garanti, Akbank, TEB, Koopbank, Yapı Kredi, vb.)
- "Dekont", "Makbuz", "Havale", "EFT", "Transfer Onay", "İşlem Sonucu" gibi başlık/etiket
- IBAN, hesap numarası, işlem referans numarası, valör tarihi gibi bankacılık alanları

REDDEDİLMESİ gereken görseller:
- POS gün sonu raporu (X/Z raporu) — "TERMINAL NO", "BATCH NO", "SLIP NO", "GÜN SONU" başlıkları
- Yazar kasa Z raporu — "MALİ HAFIZA", "Z NO", "GÜN NO"
- Mağaza satış özeti — "SATIŞ ÖZETİ", "GÜNLÜK ÖZET"
- Fatura, fiş, makbuz (banka değil)
- Tamamen alakasız görsel

ADIM 2 — Çıktı formatı (sadece JSON, code fence yok):

Eğer banka dekontu DEĞİLSE:
{
  "is_bank_receipt": false,
  "rejection_reason": "Bu bir banka dekontu gibi görünmüyor — [kısa açıklama, örn: 'POS gün sonu raporu', 'Yazar kasa Z raporu', 'Tanınmayan görsel']. Lütfen geçerli bir banka işlem makbuzu yükleyin.",
  "bank_name": null,
  "iban": null,
  "amount": null,
  "deposit_date": null,
  "currency": "TRY"
}

Eğer banka dekontu İSE:
{
  "is_bank_receipt": true,
  "rejection_reason": null,
  "bank_name": "string veya null (İş Bankası, Ziraat, Garanti, Akbank, TEB, Koopbank vb.)",
  "iban": "string veya null (TR ile başlayan 26 karakter, boşluksuz)",
  "amount": "ondalık sayı veya null (yatırılan/transfer edilen tutar)",
  "deposit_date": "YYYY-MM-DD veya null (işlem tarihi)",
  "currency": "TRY | USD | EUR | GBP (TRY varsayılan)"
}

Eşleştirme rehberi:
- "İşlem Tarihi" / "Valör Tarihi" / "Tarih" → deposit_date
- "Tutar" / "İşlem Tutarı" / "Yatırılan Tutar" → amount
- "Alıcı IBAN" / "IBAN" / "Hesap No" → iban
- "Banka" / banner üstündeki banka adı → bank_name
- Para birimi sembolü: "TL"/"₺" → TRY, "$" → USD, "€" → EUR, "£" → GBP. Yoksa TRY.
`;
