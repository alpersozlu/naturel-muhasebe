# Masraf Muhasebe Entegrasyonu — Plan & Kategori Sözlüğü

> Mavi (sonra Derimod) için aylık masraf tablosunu (kategori × ay × mağaza)
> otomatik üreten muhasebe motoru. Kaynak: kasadan çıkan masraflar (sistem zaten
> kaydediyor) + şirket kartı "Faturalı Masraflar" (kullanıcı her ay yükler) +
> Defolu (İndirim Kontrol programından push). Çıktı: "Mavi Masraflar" Excel.

**Durum:** Faz 0 (kategori mutabakatı) BİTTİ — 2026-06-19. Kullanıcı: Alper.

## Kaynak dosyalar (2025, örnek)
1. **Naturel Ticaret Muhasebe 2025.xlsx** — KASADAN çıkan masraflar. 7 mağaza sayfası,
   gün gün, `TARİH|VISA|Z-RAPORU|NOTLAR|MASRAF|AÇIKLAMA|...` (çok masraf çifti).
   Sisteme YÜKLENMEZ — sistem zaten kaydediyor (kasiyer girer → admin kilitler).
2. **FATURALI MASRAFLAR NATUREL TICARET 2025.xlsx** — şirket KARTIYLA ödenen, kasadan
   çıkMAYAN. 12 ay sayfası, dükkan ayrımı YOK. Kullanıcı her ay sisteme yükler.
3. **MAVI 2025 MASRAFLAR@.xlsx** — HEDEF ÇIKTI. Satır=kategori (A kolonu),
   sütun=ay×mağaza (9400 Lefkoşa/9401 Girne/9402 Mağusa/9403 Güzelyurt).

## Mağaza kodları (Mavi)
9400 Lefkoşa · 9401 Girne · 9402 Mağusa · 9403 Güzelyurt

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
- **Faz 4** ⏳ "Mavi Masraflar" çıktısı: ekran matris görünümü (kategori×ay×mağaza) + Excel export (Dosya 3 formatı) + "eklendi / manuel bekliyor" raporu. Kaynak (faturalı/kasa/pos) şeffaflığı.
- **Faz 5** DEFOLU ingest API (push, İndirim Kontrol → DocuFlow), Nebim `/api/ingest/retail-sales` pattern'i.
- **Faz 6** Derimod'a genişletme.

Her faz: kendi içinde build (npm run build) + preview test + commit + deploy doğrula.
