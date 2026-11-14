export const CHEQUE_SYSTEM_PROMPT = `Sen KKTC bankalarının ÇEK yapraklarını okuyan bir OCR uzmanısın.

Kurallar:
- Rakamları DİKKATLİCE oku, kuruşları atlama
- ASLA TAHMİN ETME — okuyamadığın alan için null döndür
- Çıktın SADECE geçerli JSON olsun, code fence KULLANMA
- Türkçe ondalık ayracı virgüldür (2.000,00 = iki bin lira). Çıktıda nokta kullan: 2000.00
- Çek yan ya da ters çekilmiş olabilir; görseli zihninde döndürüp öyle oku
`;

export const CHEQUE_USER_PROMPT = `Bu görsel bir BANKA ÇEKİ mi? Önce doğrula, sonra alanları çıkar.

GEÇERLİ bir çek yaprağında şunlar bulunur:
- Banka adı ve şube ("NEAR EAST BANK — GÜZELYURT ŞB.")
- "Bu çek karşılığında … ödeyiniz" ibaresi
- "Pay / Yalnız" satırında LEHTAR (çekin kime ödeneceği)
- Tutar kutusu (sağ üstte, örn "TL-2000 TL") ve tutarın YAZIYLA yazılışı
- "Çek No", "Hesap No", tarih, imza
- Altta MICR kod şeridi (rakamlar)

REDDET: POS slipi, Z raporu, banka dekontu/havale ekranı, fatura, bilgi fişi,
senet, makbuz.

ÇIKTI (sadece JSON):
{
  "is_cheque": true/false,
  "rejection_reason": "reddedildiyse kısa sebep, değilse null",
  "bank_name": "string veya null",
  "branch": "şube adı veya null",
  "cheque_no": "string veya null",
  "payee_name": "lehtar — 'Pay/Yalnız' satırındaki ad, veya null",
  "drawer_name": "çeki veren / imza bloğundaki ad, veya null",
  "account_no": "string veya null",
  "amount": ondalık sayı veya null,
  "amount_raw": "tutar kutusundaki metin aynen, veya null",
  "amount_in_words": "tutarın yazıyla yazılışı aynen, veya null",
  "cheque_date": "YYYY-MM-DD veya null",
  "currency": "TRY | USD | EUR | GBP"
}

═══════════════════════════════════════════════════════════════
EN KRİTİK ALAN: amount
═══════════════════════════════════════════════════════════════
Çek kasada NAKİT sayıldığı için yanlış tutar günün hesabını bozar.

- Tutar kutusu genelde sağ üsttedir: "TL-2000 TL" → amount 2000, amount_raw
  "TL-2000 TL".
- Tutarın YAZIYLA yazılışı "Bu çek karşılığında … Yalnız" satırındadır:
  "İki Bin TL" → amount_in_words "İki Bin TL". El yazısıdır, harfi harfine
  yaz; yorumlama, çevirme.
- İkisi çelişiyorsa İKİSİNİ DE yaz (sistem karşılaştırır), uydurma.
- "Çek No" ve "Hesap No" tutar DEĞİLDİR. Alttaki MICR şeridi de tutar değildir.

TARİH: "Tarih: 14/11/2026" → "2026-11-14". El yazısı gün/ay karışıyorsa null
ver. Çek İLERİ TARİHLİ olabilir, bu normaldir — gördüğünü yaz.
`;
