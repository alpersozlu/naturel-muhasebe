export const BANK_RECEIPT_SYSTEM_PROMPT = `Sen Türk bankalarından alınan IBAN'lı havale/transfer dekontlarını ve KKTC'de kullanılan LOCAL PAY uygulaması ödeme onaylarını okuyan bir OCR uzmanısın.

Kurallar:
- Rakamları DİKKATLİCE oku, kuruşları (virgülden sonra 2 hane) atlama
- ASLA TAHMİN ETME — okuyamadığın alan için null döndür
- Çıktın SADECE geçerli JSON olsun, code fence kullanma
- Türkçe sayı formatı: "1.234,56" → 1234.56
- IBAN'ı tam ve boşluksuz al (örn: TR12345678901234567890123456)
- IBAN bu belge türünün AYIRT EDİCİ özelliğidir — IBAN yoksa kabul etme. TEK İSTİSNA: Local Pay
  uygulamasının "Ödeme Gerçekleşti" ekranı (hesaptan ödeme = havale); orada IBAN yerine "Local Pay No" vardır
- Bankalar tutarı YAZIYLA da basar (Halkbank: "Y/(TL) UÇBİNYÜZ %00", İş Bankası: "YALNIZ ...").
  Rakamı mutlaka yazıyla tutarla karşılaştır; "3,100.00" AMERİKAN biçimidir (virgül binlik, nokta kuruş) = 3100.00
- Nokta vuruşlu/düşük çözünürlüklü dekontlarda 1↔6, 0↔8, 3↔8 karışır — yazıyla tutar varsa o esastır
`;

export const BANK_RECEIPT_USER_PROMPT = `Bu görseli ÖNCE doküman türü açısından değerlendir, sonra alanları çıkar.

ADIM 1 — Doküman türü doğrulaması:
Bu görsel bir İBAN DEKONTU mu? Geçerli İban dekontu şu özelliklere sahiptir:
- Bir bankanın logosu/adı (İş Bankası, Ziraat, Garanti, Akbank, TEB, Koopbank, Yapı Kredi, vb.)
- "Dekont", "Makbuz", "Havale", "EFT", "Transfer Onay", "İşlem Sonucu" gibi başlık/etiket
- ZORUNLU: TR ile başlayan IBAN numarası (alıcı veya gönderen) — bu olmazsa İban dekontu sayılmaz

LOCAL PAY (kabul edilir, havale sayılır): KKTC'de telefondan hesaptan ödeme uygulaması. Ekranda
"Ödeme Onay" başlığı, yeşil tik ve "Ödeme Gerçekleşti", tarih-saat, mağaza adı ("Mavi Jeans, Lefkoşa"),
"Hesaptan", tutar ("4,000.00₺" — AMERİKAN biçimi: virgül binlik, nokta kuruş), ödeyen kişinin adı,
"Local Pay No -10258-", altta "Eco-Friendly İşlem" logosu bulunur. IBAN YOKTUR; "Local Pay No" referanstır.
"Ödeme Gerçekleşti" yazmıyorsa (bekliyor / başarısız / onay istiyor) KABUL ETME.

REDDEDİLMESİ gereken görseller:
- POS gün sonu raporu (X/Z raporu) — "TERMINAL NO", "BATCH NO", "SLIP NO", "GÜN SONU" başlıkları
- Yazar kasa Z raporu — "MALİ HAFIZA", "Z NO", "GÜN NO"
- Mağaza satış özeti — "SATIŞ ÖZETİ", "GÜNLÜK ÖZET"
- Fatura, fiş, makbuz (banka değil)
- IBAN içermeyen kasa makbuzu veya elden teslim alındısı
- Tamamen alakasız görsel

ADIM 2 — Çıktı formatı (sadece JSON, code fence yok):

Eğer İban dekontu DEĞİLSE:
{
  "is_bank_receipt": false,
  "rejection_reason": "Bu bir İban dekontu gibi görünmüyor — [kısa açıklama, örn: 'POS gün sonu raporu', 'IBAN bulunmuyor', 'Yazar kasa Z raporu', 'Local Pay ekranında Ödeme Gerçekleşti yok']. Lütfen IBAN'lı bir banka transferi/havale dekontu ya da Local Pay 'Ödeme Gerçekleşti' ekranı yükleyin.",
  "kind": null,
  "reference_no": null,
  "payer_name": null,
  "success": null,
  "bank_name": null,
  "iban": null,
  "amount": null,
  "amount_raw": null,
  "amount_in_words": null,
  "deposit_date": null,
  "currency": "TRY"
}

Eğer İban dekontu ya da Local Pay ödeme onayı İSE:
{
  "is_bank_receipt": true,
  "rejection_reason": null,
  "kind": "iban_transfer" | "local_pay",
  "reference_no": "Local Pay No (örn. \"10258\", tireler olmadan) — IBAN dekontunda null",
  "payer_name": "ödeyen kişinin adı (Local Pay ekranında büyük harfle yazar) — yoksa null",
  "success": true/false (Local Pay: \"Ödeme Gerçekleşti\" görünüyor mu; IBAN dekontunda true),
  "bank_name": "string veya null (İş Bankası, Ziraat, Garanti, Akbank, TEB, Koopbank vb.; Local Pay ekranında \"Local Pay\")",
  "iban": "string veya null (TR ile başlayan 26 karakter, boşluksuz; Local Pay'de null)",
  "amount": "ondalık sayı veya null (yatırılan/transfer edilen tutar)",
  "amount_raw": "tutarın belgede BASILDIĞI haliyle metin, örn. \"3,100.00\" veya \"3.100,00\" (yoksa null)",
  "amount_in_words": "tutar YAZIYLA basılmışsa o satırın tamamı, örn. \"Y/(TL) UÇBİNYÜZ %00\" (yoksa null)",
  "deposit_date": "YYYY-MM-DD veya null (işlem tarihi)",
  "currency": "TRY | USD | EUR | GBP (TRY varsayılan)"
}

Eşleştirme rehberi:
- "İşlem Tarihi" / "Valör Tarihi" / "Tarih" → deposit_date
- "Tutar" / "İşlem Tutarı" / "Yatırılan Tutar" / "Toplam" → amount (ve amount_raw: basıldığı gibi)
- "Y/(TL)" / "Yalnız" / "Yazıyla" satırı → amount_in_words
- "Alıcı IBAN" / "IBAN" / "Hesap No" → iban
- "Local Pay No -10258-" → reference_no "10258", kind "local_pay", bank_name "Local Pay"
- Local Pay'de "Ödeme Gerçekleşti" → success true; ödeyen adı → payer_name
- "Banka" / banner üstündeki banka adı → bank_name
- Para birimi sembolü: "TL"/"₺" → TRY, "$" → USD, "€" → EUR, "£" → GBP. Yoksa TRY.
`;
