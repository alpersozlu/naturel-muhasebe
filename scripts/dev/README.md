# scripts/dev — yerel yardımcı betikler (canlıya gitmez, derlemeye girmez)

Oturumlar arasında kaybolmasın diye saklanan tek seferlik / tekrar kullanılır
betikler. Hiçbiri gizli değer içermez; anahtarlar `.env` / `.env.local`'dan okunur.

## Çalıştırma kalıbı
Betik `@/…` içe aktarımları için PROJE KÖKÜNDE durmalı: önce köke kopyala, çalıştır, sonra sil.

    cp scripts/dev/<betik>.mts tmp_x.mts
    node --env-file=.env --env-file=.env.local --conditions=react-server \
      --import ./scripts/dev/stub-hooks.mjs --import tsx tmp_x.mts
    rm tmp_x.mts

Kolay İK okuyan betikler için `KIK_DIR="$PWD/scripts/dev/kik"` ver (MUTLAK yol; betik içinde
`await import(DIR + "/shim.mjs")`) — her `api.kolayik.com` isteği canlıdaki imzalı,
salt okunur uca (`/api/jobs/kolayik`) yönlenir (anahtar yalnız Vercel'de).

## Kurallar (öğrenildi, pahalıya)
- Uygulamadaki her başarılı admin mutation'ı (`batches.prepare` DAHİL) çağıranın
  adına AuditLog yazar. Gerçek prisma ile "yalnız okuyorum" diye prosedür çağırma.
- Gerçek veride deneme: `prisma.$transaction` içinde, `$transaction`'ı aynı tx'e
  yönlendiren Proxy ile `createCaller({ prisma: txLike })`, sonunda bilerek hata
  fırlatıp GERİ AL; önce/sonra sayıları (AuditLog dahil) karşılaştır.
  Örnek: `payroll_batch_dry_run.mts`, `merge_group_dry_run.mts`.
- Yazma: uygulamanın kendi prosedürleriyle, sahibinin admin kullanıcısı adına
  (`OWNER_EMAIL`). Doğrudan prisma yazımı yalnız prosedür yoksa.
- Kolay İK: iç (belgelenmemiş) adresleri anahtarla deneme — güvenlik denetimi engeller.

## Dosyalar
- `stub-hooks.mjs`, `stub-next-headers.cjs` — `next/headers` stub'ı (loader).
- `kik/shim.mjs`, `kik/pull.mjs` — imzalı salt okunur Kolay İK erişimi.
- `kik/pending_approvals.mts` — ayın onay bekleyen mesai/izinleri (müdürler).
- `kik/overtime_check.mts` — müdür başına onaylı/bekleyen saat ↔ bordro ↔ "uygula".
- `kik/leave_balances.mts` — herkesin izin bakiyesi, hakkını aşanlar, yeni başlayanlar.
- `kik/bonus_now.mjs` — ek izin (hak günü) yıl toplamlarının iki okuma arası farkı.
- `kik/sunday_ot_apply.mts` — pazar 8 saat üstü mesaiyi bordroya işleme (MODE=dry|apply).
- `store_perf_apply.mts` — Mavi mağazası ay sonu dosyaları (STORE, FILES="a|b") → yükle → çapraz kontrol → aktar.
- `refresh_bi_docs.mts` — kayıtlı BI belgelerini yeniden okuma.
- `payroll_batch_dry_run.mts` — Ödeme 2 nakit listesi, geri alınan işlemde.
- `merge_group_dry_run.mts` — kasa birleşmesi (DayMergeGroup), geri alınan işlemde.
- `payroll_restore_overtime.mts` — AuditLog'dan önceki değeri bulup geri yazma.
- `expense_accept_once.mts` — tarih kuralına takılan masrafı tek seferlik kabul (yükleme kimliği içinde).
- `dom-sim/*.dom.test.tsx` — gerçek React bileşenlerini jsdom'da sürme (giriş gerektiren ekranlar
  için). jsdom projeye DEĞİL geçici bir klasöre kurulur (`npm install jsdom`), dosyadaki `SCRATCH`
  yolu ona çevrilir, dosya `src/__tests__/` altına kopyalanıp `npx vitest run <dosya>` ile çalıştırılır,
  sonra silinir (commit edilmez).
