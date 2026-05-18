# Phase 2 — İskelet ✅

**Tarih:** 2026-05-17 → 2026-05-18
**Commit aralığı:** `04d83ae` → `0d6b6fb`

## Tamamlandı

### Codebase
- Next.js 14.2.35 + TypeScript + Tailwind 3 + App Router + `src/` layout
- shadcn/ui (default style, Radix-based) — 13 component
- Tema: indigo-600 (#6366F1) primary (master prompt'tan)
- next-intl: tr/en routing, middleware, i18n provider

### Backend
- Prisma 6.19 + Supabase pooler (transaction + session)
- 15 model + 7 enum migration (`20260518102023_init`) Supabase'de canlı
- Supabase client'lar: browser, server (cookies), admin (service_role)
- tRPC: server (init, context, _app + brand router), client (`@/lib/trpc`),
  API route, `protectedProcedure` + `adminProcedure` middlewares

### Auth
- Supabase Auth: `signInWithPassword` + middleware redirect
- `getSession()` Supabase user + Prisma user join (email match)
- Admin user seed: `prisma/seed.ts` (Supabase admin API + Prisma upsert)
- Test user: `alpersozlu1@gmail.com` / `DocuflowTR2026!` / role=`admin`

### UI
- Sidebar (7 nav items, active state)
- LanguageSwitcher (tr/en dropdown)
- UserMenu (avatar + sign out)
- 7 placeholder sayfa: admin, verification, revenues, expenses,
  upload, history, contact
- Login page: react-hook-form değil basit useState (kasitle, basit)

### Smoke test (npm run dev)
- `/tr/login` → 200 ✅
- `/tr` (oturumsuz) → 307 → `/tr/login` ✅
- `/api/trpc/health` → 200 ✅

## Sürprizler & Çözümler
1. **Prisma 7** schema'da `url` desteklemiyor → **Prisma 6'ya düştüm**
2. **shadcn latest CLI** Tailwind 4 + base-ui generate ediyor →
   `style: "default"` + Radix + Tailwind 3'e geri çevirdim
3. **Next 14'te Geist font yok** → Inter'e geçtim (Türkçe için daha iyi)
4. **Supabase direct connection (db.xxx.supabase.co:5432)** IPv6 only,
   IPv4'ten erişilemez → `DIRECT_URL` için Session pooler kullandım
5. **Pooler hostname** `aws-1-eu-west-2` (`aws-0` değil) — manuel kopyalama gerek

## Açık öğeler (Phase 3+ için)
- RLS politika SQL'i henüz yazılmadı (şimdilik admin API kullanıyoruz, runtime'da test edilmedi)
- Supabase Storage `uploads` bucket'ı oluşturulmadı (Phase 4 öncesi)
- Audit log middleware henüz Prisma'ya bağlı değil (Phase 3 sonu)
- TCMB FX rate cron job (Phase 4 başı)

## Sonraki: Phase 3 (devam)
- Brand CRUD ✅ (`4249e50`)
- Store CRUD ⏳
- User management ⏳
- `/admin/trash` (soft delete restore) ⏳
- Audit log middleware ⏳
