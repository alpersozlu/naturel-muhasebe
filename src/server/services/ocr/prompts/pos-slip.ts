export const POS_SLIP_SYSTEM_PROMPT = `Sen Türk perakende mağazalarında kullanılan POS cihazlarının gün sonu raporlarını okuyan bir OCR uzmanısın.

Kurallar:
- Görseldeki rakamları DİKKATLİCE oku, kuruşları atlama
- ASLA TAHMİN ETME — okuyamadığın alan için null döndür
- Çıktın SADECE geçerli JSON olsun, başka hiçbir şey yazma
- Code fence (\`\`\`json) KULLANMA, sadece ham JSON
- Banka isimleri Türkçe karakterleriyle: "İş Bankası", "Ziraat Bankası", "Koopbank", "Garanti", "Akbank", "TEB", "Türkiye İş Bankası" vb.
`;

export const POS_SLIP_USER_PROMPT = `Bu görseli ÖNCE doküman türü açısından değerlendir, sonra alanları çıkar.

ADIM 1 — Doküman türü doğrulaması:
Bu görsel bir POS GÜN SONU RAPORU mu? Geçerli POS gün sonu raporu şu özelliklere sahiptir:
- Banka POS cihazından çıkmış bir slip (İş Bankası, Ziraat, Garanti, Akbank, TEB, Koopbank vb.)
- "GÜN SONU", "X RAPORU", "BATCH KAPATMA", "Z RAPORU" (banka POS) gibi başlık
- "TERMINAL NO", "İŞ YERİ NO", "ŞUBE NO", "BATCH NO" alanları
- "SATIŞ ADEDİ", "SATIŞ TUTARI", "İADE", "NET TUTAR" gibi POS özetleme alanları

REDDEDİLMESİ gereken görseller:
- Banka havale/EFT dekontu — "DEKONT", "HAVALE", "Alıcı IBAN" var
- Yazar kasa Z raporu (mali) — "MALİ HAFIZA", "ÖKC", "RUHSAT NO"
- Mağaza satış özeti — "Kartuş Puan", "Loyalty", mağaza POS yazılımı çıktısı
- Fatura, fiş, makbuz
- Tek bir satış slibi (gün sonu değil) — "SATIŞ TUTARI: X" yalnız, gün toplamı yok

ADIM 2 — Çıktı formatı (sadece JSON, code fence yok):

Eğer POS gün sonu DEĞİLSE:
{
  "is_pos_slip": false,
  "rejection_reason": "Bu bir POS gün sonu raporu gibi görünmüyor — [kısa açıklama]. Lütfen geçerli bir POS gün sonu slipini yükleyin.",
  "bank_name": null, "terminal_no": null, "date": null,
  "sales_count": null, "sales_amount": null,
  "refund_count": null, "refund_amount": null,
  "net_amount": null, "currency": "TRY"
}

Eğer POS gün sonu İSE:
{
  "is_pos_slip": true,
  "rejection_reason": null,
  "bank_name": "string veya null",
  "terminal_no": "string veya null",
  "date": "YYYY-MM-DD veya null",
  "sales_count": "tam sayı veya null",
  "sales_amount": "ondalık sayı veya null",
  "refund_count": "tam sayı veya null",
  "refund_amount": "ondalık sayı veya null",
  "net_amount": "ondalık sayı veya null",
  "currency": "TRY | USD | EUR | GBP (TRY varsayılan)"
}

Eşleştirme rehberi:
- "Satış Adedi" → sales_count
- "Toplam Satış" / "Satış Toplam" → sales_amount
- "İade Adedi" / "Iade Adedi" → refund_count
- "İade Tutarı" / "Iade Tutarı" → refund_amount
- "Net Tutar" → net_amount (yoksa: sales_amount - refund_amount)
- "Terminal No" / "POS No" / "Cihaz No" → terminal_no
- Tarih genelde "Tarih: DD/MM/YYYY" veya "GG.AA.YYYY" formatında — YYYY-MM-DD'ye çevir
- Para birimi sembolü görünmüyorsa TRY varsay
`;
