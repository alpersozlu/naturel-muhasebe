# DocuFlow TR — Klasör Yapısı

> Next.js 14 App Router + monorepo değil (tek app, basit kalsın).
> MVP'de tek package, ileride `packages/core` ayrılabilir.

```
docuflow-tr/
├── .env.local                  # Hiç commit edilmez (.gitignore)
├── .env.example                # Template, commit edilir
├── .gitignore
├── README.md
├── architecture.md             # Aşama 1 planlama
├── folder-structure.md         # bu dosya
├── package.json
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── components.json             # shadcn/ui config
├── vitest.config.ts
├── playwright.config.ts        # Aşama 7'de eklenecek
│
├── prisma/
│   ├── schema.prisma           # ✅ Aşama 1'de yazıldı
│   ├── migrations/             # Aşama 2'de oluşacak
│   └── seed.ts                 # Mavi Jeans / Lefkoşa seed (Aşama 3)
│
├── public/
│   ├── logo.svg
│   ├── icons/
│   └── locales/                # next-intl alternatif (eğer messages/ kullanmazsak)
│
├── messages/                   # next-intl ana yer
│   ├── tr.json
│   └── en.json
│
├── src/
│   ├── middleware.ts           # i18n + auth redirect
│   │
│   ├── app/
│   │   ├── layout.tsx          # Root layout (html, body)
│   │   ├── globals.css         # Tailwind base
│   │   │
│   │   └── [locale]/
│   │       ├── layout.tsx      # i18n provider + Supabase session
│   │       ├── page.tsx        # Landing / redirect to /admin or /login
│   │       │
│   │       ├── login/
│   │       │   └── page.tsx
│   │       │
│   │       └── (app)/                          # Auth gerekli
│   │           ├── layout.tsx                  # Sidebar + user menu
│   │           │
│   │           ├── admin/
│   │           │   ├── page.tsx                # Yönetici Portalı dashboard
│   │           │   ├── brands/
│   │           │   │   ├── page.tsx
│   │           │   │   └── [brandId]/
│   │           │   │       ├── page.tsx
│   │           │   │       └── stores/
│   │           │   │           └── [storeId]/page.tsx
│   │           │   ├── users/
│   │           │   │   └── page.tsx
│   │           │   └── trash/
│   │           │       └── page.tsx
│   │           │
│   │           ├── verification/
│   │           │   ├── page.tsx                # Marka/Mağaza/Yıl/Ay seçici + takvim
│   │           │   └── [recordId]/page.tsx     # Tek günün detayı
│   │           │
│   │           ├── revenues/
│   │           │   └── page.tsx                # Gelir Analizi
│   │           │
│   │           ├── expenses/
│   │           │   └── page.tsx                # Gider Analizi
│   │           │
│   │           ├── upload/
│   │           │   └── page.tsx                # 5 kart (bank/pos/summary/cash/expense)
│   │           │
│   │           ├── history/
│   │           │   └── page.tsx                # İşlem Geçmişi
│   │           │
│   │           └── contact/
│   │               └── page.tsx                # Bize Ulaşın
│   │
│   ├── components/
│   │   ├── ui/                                 # shadcn/ui (button, card, dialog vb.)
│   │   ├── layout/
│   │   │   ├── sidebar.tsx
│   │   │   ├── user-menu.tsx
│   │   │   └── language-switcher.tsx
│   │   ├── upload/
│   │   │   ├── bank-receipt-card.tsx
│   │   │   ├── pos-slip-card.tsx
│   │   │   ├── store-summary-card.tsx
│   │   │   ├── cash-advance-card.tsx
│   │   │   ├── expense-card.tsx
│   │   │   ├── ocr-review-panel.tsx            # OCR sonrası kullanıcı düzeltme
│   │   │   └── file-dropzone.tsx
│   │   ├── verification/
│   │   │   ├── calendar-view.tsx
│   │   │   ├── day-detail-panel.tsx
│   │   │   └── tolerance-badge.tsx
│   │   ├── charts/
│   │   │   ├── revenue-bar-chart.tsx
│   │   │   ├── expense-pie-chart.tsx
│   │   │   ├── cash-vs-pos-chart.tsx
│   │   │   └── bank-comparison-chart.tsx
│   │   └── shared/
│   │       ├── data-table.tsx                  # Reusable
│   │       ├── currency-display.tsx            # TRY format + tooltip original currency
│   │       └── empty-state.tsx
│   │
│   ├── lib/
│   │   ├── prisma.ts                           # Prisma client (singleton)
│   │   ├── supabase/
│   │   │   ├── client.ts                       # Browser client (anon key)
│   │   │   ├── server.ts                       # Server client (cookies)
│   │   │   └── admin.ts                        # Service role (sadece sunucu, dikkat)
│   │   ├── auth/
│   │   │   ├── session.ts                      # getServerSession helper
│   │   │   └── permissions.ts                  # canAccessStore, isAdmin
│   │   ├── i18n.ts                             # next-intl config
│   │   ├── utils.ts                            # cn, formatters
│   │   ├── currency.ts                         # toTRY, formatTRY
│   │   ├── date.ts                             # TR formatter, date math
│   │   └── constants.ts                        # TOLERANCE_TL = 5 vb.
│   │
│   ├── server/                                 # Sadece sunucuda çalışan
│   │   ├── trpc/
│   │   │   ├── trpc.ts                         # Init
│   │   │   ├── context.ts
│   │   │   └── routers/
│   │   │       ├── _app.ts                     # Root router
│   │   │       ├── auth.ts
│   │   │       ├── brand.ts
│   │   │       ├── store.ts
│   │   │       ├── user.ts
│   │   │       ├── upload.ts
│   │   │       ├── dailyRecord.ts
│   │   │       ├── verification.ts
│   │   │       ├── revenue.ts
│   │   │       ├── expense.ts
│   │   │       └── audit.ts
│   │   ├── services/
│   │   │   ├── ocr/
│   │   │   │   ├── claude-vision.ts            # Anthropic API client + prompt
│   │   │   │   ├── preprocess.ts               # sharp pipeline
│   │   │   │   ├── prompts/                    # Type-specific prompts
│   │   │   │   │   ├── pos-slip.ts
│   │   │   │   │   ├── store-summary.ts
│   │   │   │   │   ├── bank-receipt.ts
│   │   │   │   │   └── expense.ts
│   │   │   │   └── schemas/                    # Zod validation
│   │   │   │       ├── pos-slip.ts
│   │   │   │       ├── store-summary.ts
│   │   │   │       ├── bank-receipt.ts
│   │   │   │       └── expense.ts
│   │   │   ├── verification/
│   │   │   │   ├── verify-day.ts               # Ana algoritma
│   │   │   │   └── tolerance.ts
│   │   │   ├── fx/
│   │   │   │   ├── tcmb-fetcher.ts             # XML parse
│   │   │   │   └── convert.ts                  # toTRY util
│   │   │   ├── exports/
│   │   │   │   ├── revenue-xlsx.ts
│   │   │   │   ├── expense-xlsx.ts
│   │   │   │   └── _xlsx-shared.ts
│   │   │   └── audit/
│   │   │       └── audit-log.ts                # Prisma middleware
│   │   └── jobs/
│   │       ├── ocr-process.ts                  # Upload sonrası tetiklenir
│   │       └── tcmb-cron.ts                    # Günlük 16:00 TRT
│   │
│   ├── types/
│   │   ├── api.ts
│   │   ├── ocr.ts
│   │   └── domain.ts
│   │
│   └── __tests__/
│       ├── verification.test.ts
│       ├── currency.test.ts
│       └── ocr-schemas.test.ts
│
└── docs/
    ├── PHASE-02-COMPLETE.md            # Her aşama sonu burada özet
    ├── PHASE-03-COMPLETE.md
    └── ...
```

---

## Naming Convention

| Tür | Stil | Örnek |
|---|---|---|
| Dosya | `kebab-case` | `pos-slip-card.tsx` |
| React component | `PascalCase` | `PosSlipCard` |
| Function | `camelCase` | `verifyDay()` |
| Type/Interface | `PascalCase` | `PosSlipData` |
| Constant | `SCREAMING_SNAKE_CASE` | `TOLERANCE_TL` |
| Route segment | `kebab-case` | `/upload`, `/verification` |
| DB table (Prisma model) | `PascalCase` | `PosSlip`, `DailyRecord` |
| DB kolon | `snake_case` | `net_amount_try`, `created_at` |

---

## Env Variables (.env.example)

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=         # SADECE backend, ASLA NEXT_PUBLIC_

# Database (Supabase Postgres connection pooler URL)
DATABASE_URL=
DIRECT_URL=                         # Migration için (non-pooled)

# Anthropic
ANTHROPIC_API_KEY=                  # SADECE backend
ANTHROPIC_MODEL=claude-sonnet-4-6

# Vercel Cron (TCMB fetch)
CRON_SECRET=                        # Cron endpoint'ini koru

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
DEFAULT_LOCALE=tr
```

---

## Git Commit Convention

```
feat(upload): add POS slip OCR pipeline
fix(verification): handle null cash_sales in tolerance check
chore(prisma): add migration for fx_rates table
docs(phase-4): mark OCR pipeline complete
refactor(server): extract claude vision client
test(verification): add ±5 TL boundary cases
```

İngilizce commit mesajları, Türkçe kod yorumları/UI metinleri (Naturel Rent ile aynı konvansiyon).

---

## Aşama Sonu Checklist (her aşamadan sonra)

1. ✅ Yeni dosyalar `git add`
2. ✅ `npm run typecheck` temiz
3. ✅ `npm run test` geçer
4. ✅ `npm run build` başarılı
5. ✅ `docs/PHASE-XX-COMPLETE.md` özeti yaz
6. ✅ `git commit -m "feat(phase-X): ..."`
7. ✅ Kullanıcıya neyi test edebileceğini söyle
8. ✅ Bir sonraki aşama için **onay bekle**
