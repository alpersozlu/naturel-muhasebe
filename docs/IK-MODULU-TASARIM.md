# Naturel İK — izin, pazar çalışması ve mesai (tasarım)

Başlangıç: 21.10.2026. Sahibi: Alp. Amaç: Kolay İK'daki izin / mesai / onay işlerini
Naturel Muhasebe'nin içine almak; personel, müdür ve sahibi aynı programı kullanır,
onaylanan mesai Maaşlar'a kendiliğinden gider.

> **VERİ AKTARIMI YOK.** Kolay İK'daki personel, izin, mesai ve bakiyeler sahibi
> açıkça talimat verene kadar yeni programa aktarılmaz (sahibi: "düzeltmem gereken
> mesailer izinler var, yeni programa yanlış aktarılsın istemem"). Deneme hesapları
> ve sahte verilerle çalışılır.

## 1. Neden (Kolay İK'da ölçülen, Ağu – 20 Eki 2026)

- 200 iznin **123'ü pazar / bayram karşılığı**, hepsi "Yıllık İzin" türünde girilmiş;
  55'inde hangi pazar için olduğu yazmıyor.
- Sahibi her ay ~20 kişiye elle "Ekstra İzin" ekliyor; Kolay İK bunu toplu, Excel ya
  da API ile yapamıyor, listesini veren rapor da yok.
- 125 pazarın 21'inde iki hafta içinde karşılık izni yok → bakiyede birikiyor.
- 384 mesai kaydının 126'sı "eksik mola", 57'si açıklamasız; 38 kayıt (119,25 s)
  onay bekliyor, en eskisi 25.08.
- Kolay İK yeni başlayana ilk gün 14 gün yıllık izin gösteriyor; ayrılanın
  bakiyesini yıl sonuna kadar hesaplıyor (yanlış).

## 2. Kurallar (sahibi, 21.10.2026) — kod: `src/server/services/hr/`

| Konu | Kural | Kod |
|---|---|---|
| Yıllık izin | Çalıştıkça birikir: yılda 14 gün, her tamamlanan ay sonunda 14÷12 gün; başlanan ay tam sayılır. 6 ay = 7 gün. İlk gün 0. | `accrual.ts` |
| Pazar / bayram | Personel "çalıştım" der (saat yazmaz, gün = 8 saat). Müdür onaylar → **1 hak günü kendiliğinden eklenir**. Pazar/bayramda mesai yazılamaz. | `claims.ts`, `credits.ts` |
| Hak günü kullanımı | "Hak günümü kullanıyorum" → müdür onayı → en eski açık hak gününden düşer, **yıllık izne dokunmaz**. Resmi tatile denk gelen karşılık günü düşülmez. | `credits.ts` |
| Süre | Pazar: ay bitmeden kullanılır (sıkı). Bayram: aynı süre, yumuşak takip. Ayın son günü pazarsa +7 gün. | `creditDeadline` |
| Uyarı | Son 7 gün personele hatırlatma; pazar için son 5 gün müdüre + sahibine uyarı. Süre geçerse gün **silinmez**, bakiyede kırmızı (pazar) / turuncu (bayram) durur. | `creditAlerts` |
| Hafta içi mesai | Sebep listeden (açılış-kapanış, sayım, mal kabul, yoğunluk, başka — açıklamalı). "Eksik mola" yok. Yarım saat adım. **Günlük sınır yok** (sabaha kadar sayım, sevkiyat olur); 4 saati aşan gün müdüre "uzun mesai" işaretiyle gelir, 16 saat üstü yazım hatası sayılır. Müdür onaylar → Maaşlar. | `claims.ts`, `rules.ts` |
| İzin günü sayımı | Pazar izin günüdür → yıllık izinden düşmez; resmi tatil de düşmez. | `leaveDayCount` |
| Devir | Kullanılmayan yıllık izin yeni yıla devreder. | `annualLeaveBalance.opening` |
| Çıkış | Ayrılırken açık kalan hak günleri (kullanılmamış pazar/bayram) ödenir: net ÷ 26 / gün. | `settleCredits.balance` |
| Giriş | Herkesin e-postası var → e-posta + şifre. | — |
| Kolay İK | Yerine geçer. Sahibinin talimatıyla veri aktarılana kadar eski kayıt olarak kalır. | — |

### Sahibinin cevapları (21.10.2026)
1. Ayrılırken kullanılmamış pazar/bayram günü varsa ödenir. Ay ortasında ayrılan kişi o ayın yıllık izin payını **almaz** (22.10.2026).
2. Pazar izin günüdür → yıllık izin sayımında pazar düşülmez. **DİKKAT:** Kolay İK'daki kayıtlar pazarı saymış görünüyor (21.08–01.09 = 12 gün, içinde iki pazar) — politika okununca teyit.
3. Devreder.
4. Kurallar Kolay İK'da: Leave → Policies → **"MAVI DERIMOD IZIN KURALLARI"** (2 izin türü, 57 kişi; varsayılan "Örnek Türk İş Kanunu Kuralı" 2 kişide). API bu politikayı okuyamıyor (uç yok) → sahibinden ekran görüntüsü istendi. Gelince `rules.ts` ve bu tabloya işlenecek.
5. Günlük sınır yok, müdür kontrol eder.
6. Herkesin e-postası var.


### Sahibinin düzeltmeleri (22.10.2026, ekranları görünce)
- **Yıllık izin ekranda hep TAM gün**, yukarı yuvarlanmaz: 5,17 → 5; 5,8 → 5; 6 → 6
  (`summary.ts wholeDays`). "Şu gün 1 gün daha eklenecek" = sayının 1 artacağı ay sonu.
- **Mola / pazar mesaisi markaya göre:** hafta içi "Molamı kullanamadım" herkes için
  mesai sebebi. Pazar / bayram: **Mavi** en çok 8 saat, mola kullanılır, mesai
  yazılamaz; **Derimod** 8 saatin üstünü mesai yazabilir (önce o gün "çalıştım" diye
  bildirilmiş olmalı; ×2 ödenir — bordro bağlantısında) (`rules.ts restDayOvertimeAllowed`).
- **Onay sırası:** personel → kendi mağazasının müdürü; müdür (hesabı store_manager) →
  sahibi; müdürü olmayan mağaza → sahibi. Sahibi "müdür onayında bekleyenleri de
  göster" ile hepsini görüp onaylayabilir (`hr.ts approvalScope`).
- **Talep inceleme ekranı** (Kolay İK'nın talep sayfasından esinlenerek, 22.10.2026):
  listede talebe dokununca açılır — kim ne istedi (not balonu), ayrıntılar,
  "Onaylarsanız" (bakiye öncesi → sonrası, ×2 pazar, uzun mesai), onay sırası
  (oluşturan + saat → onaylayacak kişi), altta büyük Reddet / Onayla. Ret sebebi
  zorunlu, personel görür. Listede "Hızlı onay" da var.
- **"Başka bir sebep"** seçilince açıklama zorunlu; yazılmadan gönder düğmesi açılmaz.

- **Personel sekmesi** (`/ik/personel`, 22.10.2026): Kolay İK'daki tek uzun liste yerine
  mağaza mağaza (marka · mağaza başlığı, müdür en üstte). Sahibi tüm mağazalar + marka
  süzgeci + arama; müdür yalnız kendi mağazası. Satırda: bugün izinde, açık hak günü
  (kırmızı = süresi geçiyor), bekleyen talep, hesabı yok, yıllık izin (tam gün).
  Kişiye dokununca personel kartı (`hr.people`, `hr.person`).

- **Personel kartı** (Kolay İK kişi sayfasının gelişmişi, 22.10.2026 — sahibinin iki videosu):
  üstte kıdem ("1 yıl 2 ay"), tek dokunuşla Ara / WhatsApp / E-posta, uyarılar (çalışma
  izni 60 gün, pasaport 90 gün, sözleşme 30 gün kala; doğum günü 7 gün kala), eksik
  bilgi yüzdesi. Sekmeler: Özet · Bilgiler (bölüm bölüm, kopyala, düzenle) · Hesap.
  Tablo `HrProfile` (aynı göç dosyasında). Görünürlük: müdür iş + iletişim + acil
  durum; kimlik / adres / banka / belgeler yalnız sahibi ve kişinin kendisi.
  Personel "Bilgilerim"den telefon, adres, acil durum kişisini kendisi günceller.
- **Hesap** (yalnız sahibi): davet (hesap açılır, geçici şifre YOK — "şifreni belirle"
  bağlantısı e-posta + hazır WhatsApp mesajı; Resend deneme modunda e-posta yalnız
  sahibine gider), hatırlatma (yeni bağlantı; eskisi 1 saatte düşer), hesabı durdur /
  yeniden aç, davet → ilk giriş → son giriş zaman çizgisi. **İşten çıkar**: son gün
  seçilir, çıkış ön hesabı (kalan yıllık izin tam gün + açık hak günü × net ÷ 26),
  onay kutusu → durum "ayrıldı", giriş kapanır. Bağlantı denetim kaydına yazılmaz.

- **Ajanda** (`/ik/ajanda` + ana ekranda "Bu hafta" özeti; Kolay İK ana sayfa akışının
  gelişmişi, 22.10.2026): 21 gün, haftalara ve günlere bölünmüş — izinde olanlar (türü
  ve bitişi), doğum günü, iş yıldönümü, resmi tatil; müdür ve sahibine hak günü son
  günü, sahibine çalışma izni / pasaport bitişi; "Bugün mağazalarda X / Y kişi".
  Personel yalnız kendi mağazasını, izin TÜRÜ olmadan görür (`services/hr/feed.ts`).
  Doğum günü HrProfile'dan — bilgiler girilince dolar.

- **Telefon alt menüsü + Hesabım / İzinlerim / Taleplerim** (Kolay İK "Hesabım"ın
  gelişmişi, 22.10.2026): alt menü Ana sayfa · Ajanda · ➕ (pazar / izin / mesai) ·
  Taleplerim · Hesabım (`bottom-bar.tsx`, yalnız telefonda). İzinlerim: büyük tam gün,
  kullanılan / kalan çubuğu, ay ay birikim (Oca–Ara), sonraki eklenme günü, yıl sonu
  tahmini, hak günleri tek tek (kullanıldı / son gün), hastalık, bu yılın izinleri.

### Hâlâ açık
- KKTC 2026–2027 resmi tatil ve bayram listesi (program içinde sahibi girer / onaylar).
- "Örnek Türk İş Kanunu Kuralı"ndaki 2 kişi kim, onlara hangi kural uygulanır.

## 3. Kim ne görür

- **Personel** (telefon): kendi yıllık izni (hak edilen / kullanılan / kalan), hak
  günleri (her pazarın son günü, renkli), talepleri ve durumları. Üç büyük düğme:
  **"Pazar / bayram çalıştım"**, **"İzin istiyorum"**, **"Mesai yazdım"**.
- **Mağaza müdürü**: kendi mağazasının onay kutusu (tek dokunuşla onay / ret, toplu
  onay), ay sonu yaklaşırken izin kullanmamış kişiler kırmızı listesi.
- **Sahibi (admin)**: tüm mağazalar; bekleyen onaylar, süresi geçen hak günleri,
  ay kapanışı, Maaşlar'a giden mesai saatleri, kural ve tatil takvimi ayarları.

## 4. Nasıl girilir

Ayrı bir mağaza uygulaması (App Store / Google Play) yerine **Naturel Muhasebe'nin
telefona uygun web sayfası**, telefonun ana ekranına "uygulama gibi" eklenir (PWA).
Herkes kendi e-posta + şifresiyle girer. Neden: kurulum yok, iPhone ve Android'de
aynı çalışır, güncelleme anında herkese gider, Maaşlar ile aynı veritabanı.

Tasarım dili: büyük düğmeler, simge + kısa Türkçe cümle, her ekranda "ne
yapmalıyım?" açıklaması, renkler (yeşil = tamam, sarı = yaklaşıyor, kırmızı =
gecikti), takvimden tarih seçme (yazma yok), hata mesajları ne yapılacağını söyler.

## 5. Aşamalar

1. ✅ **Kural motoru** (21.10.2026) — `services/hr/` + `src/__tests__/hr-rules.test.ts` (28 sınama).
   Kolay İK politikası okundu (22.10, Safari): "MAVI DERIMOD IZIN KURALLARI" = Yıllık İzin
   14 gün/yıl **Annual** hak ediş (ilk gün 14 gün görünmesinin sebebi), tek talepte en
   çok 12 gün; Hastalık İzni 12 gün/yıl aylık, tek talepte **en çok 1 gün** (çok günlük
   hastalık bu yüzden Yıllık İzin girildi). Bizde: hastalık 12 gün/yıl ayrı tür, tek
   talepte sınır yok.
2–4. ✅ **Kod hazır, CANLIYA ALINMADI** (22.10.2026):
   - Tablolar: `prisma/migrations/20261022120000_naturel_ik` (yalnız ekleme: `UserRole.staff`,
     `PayrollEmployee.user_id`, `HrHoliday`, `HrWorkedDay`, `HrLeaveRequest`, `HrOvertime`,
     `HrLeaveOpening`). **Canlı veritabanına uygulanmadı.**
   - Sunucu: `src/server/trpc/routers/hr.ts` (me, claimWorkedDay, requestLeave,
     claimOvertime, cancel, approvals, decide, saveHoliday, deleteHoliday, accounts, linkUser).
     Müdür başkası adına girerse kayıt anında onaylı; kendi talebini onaylayamaz.
     Bordrosu kapanmış aya talep girilemez (`lockedBefore`).
   - Ekranlar: `/ik` (personel — üç büyük düğme, bakiyeler, uyarı, taleplerim), `/ik/onay`
     (müdür/sahibi — onay/ret, izin kullanmamışlar, ekip tablosu), `/ik/ayarlar` (sahibi —
     resmi tatil takvimi, personel ↔ hesap eşleştirme). Personel rolü muhasebe
     ekranlarını görmez (→ `/ik`). Telefona eklenebilir (`public/ik.webmanifest`).
   - Kullanıcı Yönetimi'nde yeni rol: "Personel (İK)".
   - Denendi: sınamalar, tip denetimi, derleme, örnek veriyle çizim. Gerçek tarayıcıda,
     girişle DENENMEDİ (tablolar canlıda yok).
2. **Veritabanı tabloları** (yalnız ekleme, boş): personel ↔ kullanıcı bağı, yeni rol
   `staff`, hak günü bildirimleri, izin talepleri (türlü: yıllık / hak günü /
   hastalık / vefat / ücretsiz), mesai talepleri, onay kayıtları, tatil takvimi,
   ay kapanışı. Not: `.env.local` canlı veritabanına bağlı — göç yalnız ekleme.
3. **Personel ekranı** (telefon önce) + giriş, ana ekrana ekleme, mobil menü.
4. **Müdür onay ekranı** + sahibi paneli.
5. **Takip ve uyarılar**: uygulama içi rozetler + e-posta (Resend alan adı
   doğrulanmadan e-posta yalnız sahibine gider — önce o), WhatsApp mesaj kopyalama.
6. **Maaşlar bağlantısı**: onaylı hafta içi mesai saatleri "Prim ve mesai girişi"ne;
   Kolay İK okuması yerine.
7. **Pilot**: tek mağaza, deneme hesaplarıyla.
8. **Kolay İK'dan aktarım** — YALNIZ sahibinin talimatıyla; önce düzeltme listesi
   (yanlış türde izinler, 8 saatten az pazarlar, bekleyen mesailer), sahibi düzeltir,
   sonra aktarılır.
