export const POS_SLIP_SYSTEM_PROMPT = `Sen Türk perakende mağazalarında kullanılan POS cihazlarının gün sonu raporlarını okuyan bir OCR uzmanısın.

Kurallar:
- Görseldeki rakamları DİKKATLİCE oku, kuruşları atlama
- ASLA TAHMİN ETME — okuyamadığın alan için null döndür
- Çıktın SADECE geçerli JSON olsun, başka hiçbir şey yazma
- Code fence (\`\`\`json) KULLANMA, sadece ham JSON
- Banka isimleri Türkçe karakterleriyle: "İş Bankası", "Ziraat Bankası", "Koopbank", "Garanti", "Akbank", "TEB", "Türkiye İş Bankası" vb.
- Türkçe ondalık ayracı virgüldür (5.399,96 = beş bin üç yüz doksan dokuz lira doksan altı kuruş). Çıktıda nokta kullan: 5399.96
`;

export const POS_SLIP_USER_PROMPT = `Bu görseli ÖNCE doküman türü açısından değerlendir, sonra alanları çıkar.

ADIM 1 — Doküman türü doğrulaması:
Bu görsel bir POS GÜN SONU RAPORU mu? Geçerli POS gün sonu raporu şu özelliklere sahiptir:
- Banka POS cihazından çıkmış bir slip (İş Bankası, Ziraat, Garanti, Akbank, TEB, Koopbank vb.)
- "GÜN SONU", "X RAPORU", "BATCH KAPATMA", "Z RAPORU" (banka POS), "GRUP KAPAMA" gibi başlık
- "TERMINAL NO", "İŞ YERİ NO", "ŞUBE NO", "BATCH NO" alanları
- "SATIŞ ADEDİ", "SATIŞ TUTARI", "İADE", "NET TUTAR", "GENEL TOPLAM" gibi POS özetleme alanları

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

═══════════════════════════════════════════════════════════════
NET TUTAR OKUMA STRATEJİSİ (en kritik alan — yanlış okumak büyük hata)
═══════════════════════════════════════════════════════════════

POS slip'lerinde tutar BİRDEN FAZLA YERDE görünür. ÇOĞU SLİP'TE en yüksek
ve en doğru rakam slip'in EN ALTINDAKİ "GENEL TOPLAM" / "GRUP TOPLAM" /
"GÜN TOPLAM" satırıdır. Bu rakam tüm kart tiplerini ve ardışık satışları
kapsayan toplamdır.

Öncelik sırası (yukarıdan aşağıya bak):
1. "GENEL TOPLAM" satırı (en yüksek öncelik) → net_amount
2. "GRUP KAPAMA TOPLAM" / "GRUP KAPAMA TAMAMLANDI: X TL" → net_amount
3. "GÜN TOPLAM" / "GÜN SONU TOPLAM" → net_amount
4. "NET TUTAR" / "NET TOPLAM" → net_amount (tek bölüm slip'lerde)
5. "TOPLAM TUTAR" (tek bölüm varsa) → net_amount

⚠ KRİTİK — ÇOK BÖLÜMLÜ SLİP DURUMU:
Bazı POS slip'leri (özellikle Koopbank Optimum, bazı Garanti, bazı Ziraat)
birden fazla kart tipi için AYRI ALT BÖLÜMLER gösterir:
  - SATIŞ CTLS / KREDİ KARTI:   TOPLAM TUTAR: 5.399,96 TL
  - SATIŞ / YURTİÇİ DEBİT KARTI:  TOPLAM TUTAR: 1.699,97 TL
  - SATIŞ / DEBİT KARTI:          TOPLAM TUTAR: 3.049,95 TL
  …
  GENEL TOPLAM:                                    10.149,88 TL

Bu durumda:
- ASLA tek bir alt bölümün TOPLAM TUTAR'ını net_amount olarak alma
- HER ZAMAN slip'in EN ALTINDAKİ GENEL TOPLAM / GRUP TOPLAM rakamını al
- Eğer GENEL TOPLAM görünmüyorsa, tüm alt bölümlerin TOPLAM TUTAR'larını
  TOPLAYIP net_amount yap

⚠ KRİTİK — İADE DÜŞÜMÜ:
- İADE'ler ZATEN GENEL TOPLAM'dan düşülmüş olur (sıfır iade varsa fark etmez)
- "GENEL TOPLAM" varken iade hesaplamasını kendin yapma — slip'teki rakamı al
- İade rakamlarını sadece refund_count ve refund_amount alanları için oku

═══════════════════════════════════════════════════════════════
SALES_COUNT (satış adedi) okuma:
═══════════════════════════════════════════════════════════════
- Tek bölüm slip: "SATIŞ ADEDİ: 12" → 12
- Çok bölümlü slip: tüm alt bölümlerin "TOPLAM ADET"lerini topla
  (örn. 1 + 1 + 1 = 3)
- GENEL TOPLAM ADET varsa onu kullan

═══════════════════════════════════════════════════════════════
DİĞER ALAN EŞLEŞTİRMELERİ
═══════════════════════════════════════════════════════════════
- "İade Adedi" / "Iade Adedi" / "İPTAL ADET" → refund_count
- "İade Tutarı" / "Iade Tutarı" / "İPTAL TUTAR" → refund_amount
- "Terminal No" / "POS No" / "Cihaz No" / "İŞYERİ NO" → terminal_no
- Tarih: "Tarih: DD/MM/YYYY" veya "DD.MM.YYYY" veya "DD/MM/YYYY" — YYYY-MM-DD'ye çevir
- Para birimi sembolü görünmüyorsa TRY varsay
- "Koopbank", "KOOPBANK" → bank_name: "Koopbank"

═══════════════════════════════════════════════════════════════
KENDİNİ TEST ET (JSON ÇIKTISINDAN ÖNCE)
═══════════════════════════════════════════════════════════════
Net_amount okuduğun rakam, slip'in EN ALTINDAKİ en büyük rakam mı?
Slip'te birden fazla "TOPLAM TUTAR" gördüysen, MUTLAKA "GENEL TOPLAM"
satırını aradın mı? Eğer şüphedeysen, en alttaki rakamı tercih et.
`;
