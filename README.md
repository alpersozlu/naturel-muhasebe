# DocuFlow TR

> 7 mağazalı perakende zincirinin günlük iç muhasebesini OCR + AI ile otomatikleştiren web uygulaması.

**MVP scope:** Mavi Jeans / Lefkoşa (1 marka + 1 mağaza). Tam akış çalıştıktan sonra 7 mağazaya ölçeklenir.

## Hızlı başlangıç

```bash
# 1) Ortam değişkenlerini doldur
cp .env.example .env.local
# .env.local'i editörde aç ve Supabase + Anthropic credential'larını gir

# 2) Veritabanı şemasını uygula
npx prisma migrate dev

# 3) Seed (Mavi Jeans / Lefkoşa)
npx prisma db seed

# 4) Geliştirme sunucusu
npm run dev
```

→ http://localhost:3000

## Stack

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui
- **Backend:** Next.js API routes + tRPC + Prisma
- **DB / Auth / Storage:** Supabase (PostgreSQL + RLS)
- **OCR:** Anthropic Claude (claude-sonnet-4-6 vision)
- **Charts:** Recharts
- **i18n:** next-intl (TR + EN)

Detaylar için [architecture.md](./architecture.md) ve [folder-structure.md](./folder-structure.md).

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm run dev` | Geliştirme sunucusu (http://localhost:3000) |
| `npm run build` | Production build |
| `npm run start` | Production sunucusu |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript kontrolü |
| `npm test` | Vitest |
| `npx prisma migrate dev` | Yeni migration oluştur ve uygula |
| `npx prisma studio` | DB GUI (http://localhost:5555) |

## Roller

- **admin** — Tüm yetkiler. Onay/kilitleme yapar.
- **store_manager** / **cashier** — Sadece kendi mağaza(lar)ının verisini görür ve yükler.
- **sales_rep** — Pasif rol (MVP'de kullanılmıyor).

## Doğrulama mantığı

Her gün için:
```
Σ(POS NET) + Nakit Satışlar + Kartuş Puan ≈ Mağaza Raporu Satış Toplam
```

`|fark| ≤ 5 TL` → ✅ YEŞİL
`|fark|  > 5 TL` → ❌ KIRMIZI (admin müdahale eder)

## Phase durumu

- ✅ **Aşama 1** — Planlama (architecture.md, schema.prisma, folder-structure.md)
- 🔄 **Aşama 2** — İskelet (Next.js + Supabase + Prisma + auth)
- ⏳ **Aşama 3** — Yönetici Portalı
- ⏳ **Aşama 4** — Yükleme + OCR pipeline
- ⏳ **Aşama 5** — Doğrulama Sistemi
- ⏳ **Aşama 6** — Analiz dashboard'ları
- ⏳ **Aşama 7** — İşlem Geçmişi + polish
- ⏳ **Aşama 8** — Production deploy

Her aşama tamamlandığında `docs/phases/PHASE-XX-COMPLETE.md` yazılır.
