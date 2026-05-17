# Credential Kurulum Rehberi

> Aşama 2'nin son adımı: dış servislere bağlanmak için credential toplamak.
> Tüm değerler `.env.local` dosyasına gidecek — bu dosya `.gitignore`'da, asla commit edilmiyor.

---

## 1️⃣ Supabase Projesi Oluştur (5 dakika)

1. [supabase.com/dashboard](https://supabase.com/dashboard) aç, giriş yap.
2. **New Project** → şu bilgileri ver:
   - **Name:** `docuflow-tr` (veya istediğin)
   - **Database Password:** GÜÇLÜ bir şifre üret ve **bir yere not et** (geri görme yok)
   - **Region:** `Europe (Frankfurt)` veya `Europe (Stockholm)` — KKTC'ye yakın
   - **Pricing Plan:** Free (MVP için yeter)
3. Proje kurulmasını bekle (~2 dakika).

### Credential'ları topla
Sol menüden:

**Settings → API**
- `Project URL` → bu `NEXT_PUBLIC_SUPABASE_URL`
- `anon` `public` key → bu `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` `secret` key → bu `SUPABASE_SERVICE_ROLE_KEY` ⚠️ **Asla frontend'e koyma**

**Settings → Database → Connection string**
- **Transaction pooler** (URI tabını seç, `pgbouncer=true` ile bitiyor) → bu `DATABASE_URL`
- **Session pooler** veya **Direct connection** → bu `DIRECT_URL` (migration için)
- Connection string'lerdeki `[YOUR-PASSWORD]` placeholder'ını yukarıda not ettiğin DB şifresiyle değiştir.

---

## 2️⃣ Anthropic API Key Oluştur (2 dakika)

1. [console.anthropic.com](https://console.anthropic.com) → giriş yap.
2. **Settings → API Keys → Create Key**
3. İsim: `docuflow-tr-dev`
4. Workspace: Default (veya istediğin)
5. Key'i kopyala (sadece bir kez gösterilir) → bu `ANTHROPIC_API_KEY`
6. **Billing:** Settings → Plans & Billing → en az $5 yükle (MVP test için yeter, OCR ~$0.02/upload)

---

## 3️⃣ GitHub Repo Oluştur (1 dakika — opsiyonel, sonra da olur)

1. [github.com/new](https://github.com/new)
2. **Repository name:** `docuflow-tr`
3. **Private** seç
4. **Initialize this repository with:** hiçbirini işaretleme (boş repo)
5. Create → açılan sayfada `git@github.com:KULLANICIADIN/docuflow-tr.git` URL'ini kopyala

---

## 4️⃣ CRON_SECRET Üret (10 saniye)

Terminalde:
```bash
openssl rand -hex 32
```

Çıkan değeri `CRON_SECRET` olarak kullan. (Vercel Cron endpoint'ini koruyor, MVP'de henüz aktif değil ama hazır olsun.)

---

## 5️⃣ Hazır olduğunda

Bana şu mesajla geri dön:

> **"Hazırım, devam edelim. İşte değerler:"**
>
> - SUPABASE_URL: `https://xxxxx.supabase.co`
> - ANON_KEY: `eyJh...`
> - SERVICE_ROLE_KEY: `eyJh...`
> - DATABASE_URL: `postgresql://postgres.xxxxx:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true`
> - DIRECT_URL: `postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres`
> - ANTHROPIC_API_KEY: `sk-ant-...`
> - GitHub remote: `git@github.com:.../docuflow-tr.git` (opsiyonel)
> - CRON_SECRET: `abc123...`

Veya: `.env.local`'i kendi başına oluşturup tüm değerleri yazdıysan, sadece **"hazır, .env.local dolduruldu"** de — ben kontrol ederim.

---

## Sonra ben ne yapacağım

1. `.env.local`'i yaz (veya kontrol et)
2. `npx prisma migrate dev --name init` → 14 tablo + tüm enum'lar oluşur
3. Supabase Storage'da `uploads` bucket'ı oluştur (signed URL ile)
4. RLS politika SQL'leri yaz ve uygula
5. Basit bir bağlantı testi (`npm run dev` + `/login` sayfası yükleniyor mu?)
6. Aşama 2 complete commit'i at
7. `docs/phases/PHASE-02-COMPLETE.md` yaz
8. Aşama 3 (Yönetici Portalı) onayını iste

---

## Güvenlik notları

- `.env.local` ASLA git'e gitmemeli (`.gitignore`'da)
- `SUPABASE_SERVICE_ROLE_KEY` ve `ANTHROPIC_API_KEY` sadece backend'de — `NEXT_PUBLIC_` prefix'i yok
- Şifreni paylaşırken DM/Slack kullan, public chat'te yapıştırma
- Bir credential sızdıysa: hemen Supabase'de "Reset" / Anthropic'te "Revoke" yap, yenisini üret
