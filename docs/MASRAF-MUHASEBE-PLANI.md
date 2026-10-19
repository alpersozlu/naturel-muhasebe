# Masraf Muhasebe Entegrasyonu — Plan & Kategori Sözlüğü

> Mavi (sonra Derimod) için aylık masraf tablosunu (kategori × ay × mağaza)
> otomatik üreten muhasebe motoru. Kaynak: kasadan çıkan masraflar (sistem zaten
> kaydediyor) + şirket kartı "Faturalı Masraflar" (kullanıcı her ay yükler) +
> Defolu (İndirim Kontrol programından push). Çıktı: "Mavi Masraflar" Excel.

**Durum:** Faz 0-6 BİTTİ — 2026-06-19. **Faz 7 (19.10.2026): fatura FOTOĞRAFI otomasyonu + bordro + elle hücreler; satır düzeni sahibinin Excel'i.** Kullanıcı: Alper.

## Kaynak dosyalar (2025, örnek)
1. **Naturel Ticaret Muhasebe 2025.xlsx** — KASADAN çıkan masraflar. 7 mağaza sayfası,
   gün gün, `TARİH|VISA|Z-RAPORU|NOTLAR|MASRAF|AÇIKLAMA|...` (çok masraf çifti).
   Sisteme YÜKLENMEZ — sistem zaten kaydediyor (kasiyer girer → admin kilitler).
2. **FATURALI MASRAFLAR NATUREL TICARET 2025.xlsx** — şirket KARTIYLA ödenen, kasadan
   çıkMAYAN. 12 ay sayfası, dükkan ayrımı YOK. Kullanıcı her ay sisteme yükler.
3. **MAVI 2025 MASRAFLAR@.xlsx** — HEDEF ÇIKTI. Satır=kategori (A kolonu),
   sütun=ay×mağaza (9400 Lefkoşa/9401 Girne/9402 Mağusa/9403 Güzelyurt).

## Mağaza kodları
**Mavi (SAP):** 9400 Lefkoşa · 9401 Girne · 9402 Mağusa · 9403 Güzelyurt
**Derimod (NEBIM):** S01 Lefkoşa · S02 Mağusa · S03 Girne
> Şirket kartı faturalı masrafı 7 mağazayı (4 Mavi + 3 Derimod) kapsar; ÷7 → Mavi çıktısı
> 4 payı, Derimod çıktısı 3 payı (3/7) gösterir. Registry: `src/lib/masraf/brands.ts`.

## KATEGORİ SÖZLÜĞÜ (mutabakat — final)

### Sistemin OTOMATİK dolduracağı kategoriler
| Kategori | Kaynak | Ham etiketler / kural |
|---|---|---|
| **İŞÇİ** | Kasa | işçi parası, derimod işçi, deneme personeli |
| **YEMEK** | Kasa+Kart | yemek, işçi/sayım yemek, **su, damacana su**, kahve |
| **TERZİ** (=tamir) | Kasa+Kart | terzi, metin terzi, tamir, lastik tamir, oto lastik servis |
| **KIRTASİYE** | Kasa+Kart | kirtasiye, koli bandı, hafıza kartı |
| **TEMİZLİK** | Market türevi | market kuralından gelen ½ (+ cam temizliği) |
| **MAZOT** (Dosya 3 R35/OFİS) | Kasa+Kart | benzin, mazot |
| **SEYAHAT** | Kasa+Kart | taksi, hotel |
| **KİRA** | Kart (sadece Güzelyurt) | orange mall ciro kira + ortak alan bedeli; ay açıklamadan parse |
| **POS GİDERİ** | Otomatik %5 | sabit %5 (gerçek komisyon Gider Analizi'nde kalır) |
| **DİĞER GİDERLER** | Kasa+Kart | camcı, cms, bilişim (fibera/arinet/fsc/world tech/figensoft), elektrik/klima/jeneratör/tesisat (küçük işler), alüminyum, bağış, dekorasyon/raf/boya/perde, belediye, vergi, aidat, mezarcı, ceza... |
| **DEFOLU** | İndirim Kontrol → ingest API push | ay×mağaza defolu zarar toplamı |

### Kullanıcının MANUEL gireceği kategoriler (sistem "manuel bekliyor" işaretler)
- **ÇALIŞMA ÜCRETİ** (maaş/SSK/yol/prim/mesai + **pazar parası** — 2026'da maaşa dahil)
- **ELEKTRİK** (ana fatura — kasadaki küçük elektrik/klima/tesisat DİĞER'e gider)
- **TELEFON/İNTERNET** (ana — karttaki internet/bilişim DİĞER'e gider)
- **KARGO, BANKA MASRAFI, MUHASEBE, SİGORTA**
- **Diğer mağaza kiraları** (Güzelyurt hariç 3 Mavi + ortak giderler)

### Özel kurallar
1. **Faturalı (kart) dağıtımı:** kategoride aylık topla → **÷7** → her mağazaya **eşit** ekle (mevcut kasadan-çıkan masrafının üstüne).
2. **MARKET:** kategori değil, dağıtım kuralı. Aylık market toplamı ÷7 → her mağaza payı **2'ye bölünür: ½ TEMİZLİK + ½ YEMEK**.
3. **KİRA zamanlaması:** ödeme ayı ≠ ait olduğu ay. Açıklamadaki ay adı ("orange mall **şubat** kira") → o aya yazılır. Sadece Güzelyurt + ortak alan.
4. **POS GİDERİ:** export'ta sabit %5 (Mavi'ye ortalama gösterim). Gider Analizi'nde gerçek banka komisyonu DEĞİŞMEZ.
5. **PAZAR:** sistemde YOK SAYILIR (kullanıcı manuel maaşa ekliyor).
6. **Döviz:** kart dosyasında bazı tutarlar $ ("840$") — TL'ye çevrilmeli ya da işaretlenmeli (kur kararı Faz 2'de).

## FAZ PLANI
- **Faz 0** ✅ Kategori mutabakatı (bu döküman)
- **Faz 1** ✅ Kategorize motoru (`src/lib/masraf/categorize.ts`, kelime-sınırı) + KKTCMB döviz servisi (`src/server/services/fx/kktcmb.ts`, tarih bazlı satış kuru).
- **Faz 2** ✅ Faturalı Masraf yükleme: model (`InvoicedExpenseBatch`/`Item`), parse (`parse-invoiced.ts`), router (`invoicedExpense`), UI `/tr/invoiced-expense` (sürükle-bırak + ay ay + kategori düzelt + onayla). Gerçek 2026 dosyasıyla test edildi.
- **Faz 3** ✅ Dağıtım motoru (`src/server/services/masraf/dagitim.ts`): `faturaliDagitim` (÷7, MARKET ½/½, KİRA→Güzelyurt belongs_month) + `masrafMatrix` (faturalı + kasa[Expense/CashAdvance açıklamadan kategorize] + POS %5, kaynak ayrımlı). Query: `invoicedExpense.distribution` / `.matrix`.
- **Faz 4** ✅ "Mavi Masraflar" çıktısı. Satır sırası (Faz 6'da `src/lib/masraf/brands.ts`'e taşındı,
  oto + manuel kategoriler) → rapor şekillendirme (`src/server/services/masraf/mavi-report.ts`,
  ay/mağaza toplamları + kaynak bayrakları) → Excel (`src/server/services/exports/excel/mavi-masraflar.ts`,
  Dosya 3 matris sayfası + "Kaynak & Özet" sayfası). Query `invoicedExpense.report`,
  mutation `invoicedExpense.exportMatrix`. UI: `/tr/invoiced-expense` altına matris bölümü
  (`src/components/masraf/mavi-matrix-section.tsx`) — yıl/ay seçici + kaynak rozeti (aya duyarlı) +
  "manuel bekliyor" işareti + Excel indir. Gerçek 2026 veriyle preview'da doğrulandı (Kira→sadece
  Güzelyurt, POS→kilitli satış, manuel satırlar boş). Build temiz.
- **Faz 5** ✅ DEFOLU ingest API. Model `DefoluEntry` (year/month/store_code/amount_try, unique).
  Route `POST /api/ingest/defolu` (Bearer `INGEST_API_TOKEN`, Nebim pattern'i; store_code/store_name→Mavi kodu
  çözümleme, idempotent upsert, matched/unmatched raporu). Matrise bağlandı: `MatrixCell.defolu` +
  `masrafMatrix` DEFOLU adımı + `mavi-rows` DEFOLU→auto + rapor/UI/Excel'de "Defolu" kaynak rozeti.
  Örnek push ile uçtan uca doğrulandı (401 auth, idempotency, ad çözümleme, matris dolumu); test verisi temizlendi.
- **Faz 6** ✅ Derimod'a genişletme — motor marka-parametrik. Marka registry `src/lib/masraf/brands.ts`
  (tek kaynak: kodlar, kira hedefi, satır sırası, başlık/dosya adı). `faturaliDagitim`/`masrafMatrix`/
  `buildMaviReport`/`exportMatrix`/`report` query'leri `brandKey` (default "mavi") alır. UI'da marka seçici
  (Mavi/Derimod). Kararlar: ortak ÷7 (Derimod 3/7 payı), Derimod kodları S01/S02/S03 (NEBIM), Derimod KİRA+DEFOLU manuel.
  **Sızıntı düzeltmesi:** kasa/POS artık `brand_id` ile filtreleniyor — önceden `maviCodeFromName("DERIMOD LEFKOSA")→9400`
  olduğu için Derimod kasa/POS'u Mavi'ye sızıyordu. Mavi rakamları bu yüzden Faz 4'e göre düştü (DOĞRU hale geldi);
  kaybolan veri Derimod çıktısında. Her iki marka preview'da doğrulandı, Excel ayrı dosya adlarıyla iniyor.
  **Açık uçlar (Derimod operasyonu büyürse):** Derimod POS şu an `StoreSummary` kilitli günlerden gelir —
  Derimod NEBIM satışından (NebimSaleLine) besleme gerekebilir; Derimod İndirim Kontrol/defolu push yok.

### Faz 4 başlangıç notu (yeni session için)
Hazır olan: `invoicedExpense.matrix` query → `masrafMatrix(year)` döner
`matrix[kategori][ay 1-12][mağaza kodu 9400-9403] = {total, invoiced, cash, pos}`.
Mağaza kodları: 9400 Lefkoşa / 9401 Girne / 9402 Mağusa / 9403 Güzelyurt.

Yapılacaklar:
1. **Excel export builder** — mevcut pattern `src/server/services/exports/excel/{advances,expense}.ts` model alınır → `mavi-masraflar.ts`. **Dosya 3 formatı:** satır = kategori (A kolonu), sütun = ay × 4 mağaza (R2'de 9400/9401/9402/9403 tekrarı). Mutation `invoicedExpense.exportMatrix` (exceljs buffer → base64 indir, bkz. mevcut `analytics.exportAdvances`).
2. **Ekran matris görünümü** — `/tr/invoiced-expense` sayfasına sekme/bölüm ya da ayrı sayfa: yıl seç + kategori×ay×mağaza tablo + kaynak rozeti (faturalı/kasa/pos) + "Excel indir".
3. **Manuel kategoriler** — Çalışma Ücreti, Elektrik(ana), Telefon/İnternet(ana), Kargo, Banka, Muhasebe, Sigorta, diğer mağaza kiraları, Defolu: sistemde otomatik dolmaz → tabloda "manuel bekliyor" olarak işaretle (kullanıcı kendi girer / Faz 5 defolu).
Not: kasa/POS gerçek veri gelince dolacak; şu an çoğunlukla faturalı görünür.

Her faz: kendi içinde build (npm run build) + preview test + commit + deploy doğrula.

## FAZ 7 — Fatura fotoğrafı otomasyonu (19.10.2026, Ekim'den itibaren)

Sahibi: "Ekim ayı ve itibaren bütün faturalı ve faturasız masrafları otomasyona çeviriyorum… bütün
masraf faturalarını tek tek fotoğraf çekeceğim… sistem analiz edecek… hangi fatura şirket faturası hangi
fatura mağaza faturası ayırt edebilecek… daha evvel mağaza tarafından yüklenmediyse şirket faturasıdır…
7'ye böleriz… yemek = yemek + market'in yarısı; temizlik = temizlik + market'in yarısı; others =
kategorisi bulunamayan; işçi parası → çalışma ücreti; POS gideri = %5 toplam Visa."

### Kaynaklar → satır
| Kaynak | Model | Satır | Dağıtım |
|---|---|---|---|
| Fatura fotoğrafı (sahibi) | `MasrafInvoice` (classification=company) | kategori (OCR+satıcı+açıklama → `categorizeExpense`) | ÷7 (toplam mağaza), market ½/½, kira → Güzelyurt |
| Fatura fotoğrafı ↔ mağaza fişi | `MasrafInvoice` (classification=store, `matched_expense_id`) | sayılmaz (kasada zaten var) | — |
| Kart Excel'i (eski) | `InvoicedExpenseItem` (onaylı) | kategori | ÷7 |
| Mağaza masraf fişi | `Expense` (+ `masraf_category` düzeltmesi) | kategori+satıcı+açıklama | mağazanın kendisine |
| Faturasız peşin ödeme | `CashAdvance` (bonus hariç, + `masraf_category`) | kategori+açıklama | mağazanın kendisine; işçi → ÇALIŞMA ÜCRETİ |
| POS | `StoreSummary.credit_card_total_try` (kilitli günler) | POS GİDERİ | Visa × %5 |
| Defolu | `DefoluEntry` | DEFOLU | push |
| Bordro | `PayrollLine` (computeFromLine) | ÇALIŞMA ÜCRETİ (baz + diğer ek hak ediş), PRİM (komisyon+primler+bonus), MESAİ, TAZMİNAT (izin/çıkış ödemesi) | mağazanın kendisine |
| Elle | `MasrafManualEntry` (marka/yıl/ay/mağaza/satır) | her satır | hücreye eklenir; 0 → silinir |

### Eşleştirme (`services/masraf/invoice-match.ts`, saf; `invoices.ts` DB)
1. Aynı dosya (SHA-256) — mağaza aynı fotoğrafı yüklediyse OCR'sız bağlanır.
2. Basılı belge no aynı + tutar aynı.
3. Tutar aynı (±0,02) + tarih ±3 gün + satıcı benzerliği ≥ 0,6 (`nameSimilarity`); iki tarafta da belge no var ve FARKLIYSA eşleşmez.
Aynı faturanın ikinci fotoğrafı → `duplicate`. Yönetici kararı (`decided_by`) otomatik yeniden eşleştirmede ezilmez.
Mağaza sonradan fiş yüklerse `process-upload` → `relinkInvoicesForExpense` şirket faturasını mağaza faturasına çevirir; ayrıca "Yeniden eşleştir" düğmesi.

### Satır düzeni (brands.ts = sahibinin MAVI MASRAFLAR 2026.xlsx)
KİRA → Kira, Kira (Stopaj/KDV) · PERSONEL → Çalışma Ücreti, Yemek, SSK, Yol, Prim, Personel Stopajı, Tazminat, Mesai ·
DİĞER GİDERLER → Muhasebe, Terzi, Telefon/İnternet, POS Gideri, Kırtasiye, Temizlik, Seyahat, Kargo, Elektrik, Banka, Sigorta, Diğer, Defolu ·
OFİS → Kira, Maaş, SSK, Diğer, Mazot, Sigorta. Excel'de grup başlıkları SUM formülü; GENEL TOPLAM = grupların toplamı.

### Ekran (`/tr/invoiced-expense` "Masraflar")
Dönem/marka seçici → Fatura fotoğrafları (sürükle-bırak, OCR tek tek, durum rozetleri, kategori/sınıf/ay/tutar düzeltme, mağaza kaydına elle bağlama, mükerrer, okunamayan → yeniden oku) →
Masraf matrisi (gruplu; ay seçiliyken hücreye tıkla → elle tutar; "Kasa kalemleri" penceresi: mağaza fişleri + faturasız ödemeler satır düzeltme; kaynak rozetleri: Şirket ÷7 / Kasa / POS %5 / Defolu / Bordro / Elle) →
Kart Excel'i (eski yöntem, katlanır).

### Kalibrasyon (19.10, sahibinin Excel'i ↔ sistem)
PRİM ve MESAİ Ağustos/Eylül dört mağazada kuruşuna tutuyor (ör. Lefkoşa Eylül prim 64.500 ↔ 64.499,31; mesai 9.605 ↔ 9.604,30).
ÇALIŞMA ÜCRETİ: Mağusa/Güzelyurt tutuyor; Lefkoşa Excel'de ~49–53.000 ₺ FAZLA (Ağu 745.270 ↔ 692.269,63; Eyl 775.270 ↔ 726.269,63) — sahibine soruldu (bordro dışı bir kişi?). Girne Eylül Excel 560.000 ↔ sistem 559.672,44 (izin/çıkış ödemesi artık TAZMİNAT satırında).
POS: Ekim Lefkoşa 1–18 Visa 5.742.760,24 (POS fişleriyle gün gün tutuyor) × %5 = 287.138,01.
