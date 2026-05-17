# DocuFlow TR — Mimari ve Teknik Plan

> **Sürüm:** v0.1 (Aşama 1 — Planlama)
> **Tarih:** 2026-05-17
> **Sahip:** Alper Sözlü (alpersozlu1@gmail.com)
> **Hedef MVP:** Mavi Jeans / Lefkoşa mağazası için tam akış

---

## 1. Vizyon

7 mağazalı bir perakende zincirinin **günlük iç muhasebesini** otomatikleştiren web uygulaması. Her gün her mağaza:
1. POS slip fotoğraflarını yükler (1 mağazada 3-4 banka pos cihazı)
2. Mağaza özet raporunu yükler
3. Banka dekontunu yükler
4. Masraf/peşin ödeme girer

→ Sistem **OCR ile veriyi çıkarır → doğruluk eşitliğini kontrol eder → admin onayına sunar → kilitler → analiz dashboard'larında özetler.**

**MVP scope:** 1 marka (Mavi Jeans) + 1 mağaza (Lefkoşa). 7 mağaza ölçeklemesi 2. iterasyonda.

---

## 2. Teknoloji Stack'i

| Katman | Seçim | Neden |
|---|---|---|
| Framework | Next.js 14 (App Router) + TypeScript | Server Components + tek codebase frontend+API |
| Styling | Tailwind CSS + shadcn/ui | Hızlı, modern, custom override kolay |
| State/Data | React Server Components + tRPC | Type-safe API, RSC fetch'ler |
| Forms | react-hook-form + zod | Type-safe validation |
| Charts | Recharts | Dashboard grafikleri |
| i18n | next-intl | TR (default) + EN |
| DB | PostgreSQL (Supabase) | Managed, RLS hazır |
| ORM | Prisma | Type-safe queries, migration sistemi |
| Auth | Supabase Auth | Email/password + magic link |
| File Storage | Supabase Storage | Signed URL, RLS entegre |
| OCR | Anthropic Claude (claude-sonnet-4-6 vision) | Görsel + PDF, JSON çıktı, fine-tuning gereksiz |
| Image preproc | sharp | Auto-rotate, contrast boost (kötü çekilmiş slipler için) |
| PDF parsing | pdf-parse | Text-based PDF'ler için (vision'a göndermeden önce dene) |
| Excel export | SheetJS (xlsx) | Tüm rapor export'ları |
| FX rates | TCMB günlük XML cache | TRY çevrim için |
| Deploy | Vercel (frontend+API) + Supabase (DB+auth+storage) | Standart |
| Testing | Vitest + Playwright (E2E) | Unit + integration |

**Para birimi:** TRY ana. USD/EUR/GBP girişler TCMB kuruyla TRY'ye çevrilir, **original currency + TRY ikisi de saklanır**.

---

## 3. Mimari Diyagram (Veri Akışı)

```
┌──────────────────────────────────────────────────────────┐
│  KASİYER / MAĞAZA MÜDÜRÜ                                 │
│  Mobile-first browser (Safari/Chrome)                    │
└──────────────────────────────────────────────────────────┘
                          │
                          │ Upload (image/PDF, max 10MB)
                          ▼
┌──────────────────────────────────────────────────────────┐
│  NEXT.JS 14 (Vercel)                                     │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ /app/[locale]/(app)/upload  (RSC + form)           │  │
│  └────────────────────────────────────────────────────┘  │
│                          │                               │
│                          ▼                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │ tRPC: upload.createUpload                          │  │
│  │   1. Auth check + RLS                              │  │
│  │   2. Upload to Supabase Storage (signed URL)       │  │
│  │   3. Insert into `uploads` table (status=pending)  │  │
│  │   4. Trigger OCR job (server action veya queue)    │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│  OCR PIPELINE (server-side, Anthropic API)               │
│                                                          │
│  1. sharp ile preprocess (rotate, contrast, resize)      │
│  2. PDF ise pdf-parse ile text dene; başarısızsa vision  │
│  3. Claude vision'a base64 + structured JSON prompt      │
│  4. Zod ile JSON validate                                │
│  5. raw_ocr_json + parsed_data_json → DB                 │
│  6. Type'a göre dispatch:                                │
│       pos_slip   → pos_slips tablosu                     │
│       store_sum  → store_summaries                       │
│       bank_recpt → bank_receipts                         │
│       expense    → expenses                              │
│  7. Verification job tetikle                             │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│  VERIFICATION ENGINE                                     │
│                                                          │
│  Σ(POS NET) + Nakit Satışlar + Kartuş Puan               │
│      vs. Mağaza Raporu Satış Toplam                      │
│                                                          │
│  |fark| ≤ 5 TL  → status=match   (YEŞİL)                 │
│  |fark|  > 5 TL → status=mismatch (KIRMIZI)              │
│  Manual override → admin user_id + not saklanır          │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│  ADMIN DASHBOARD                                         │
│  • Doğrulama Sistemi (takvim, renk kodlu günler)         │
│  • Onayla / Kilitle butonu → daily_records.status        │
│  • Gelir/Gider analizleri (Recharts)                     │
│  • Excel export                                          │
│  • Audit log her aksiyonu kaydeder                       │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Auth & Yetkilendirme

### Roller
- `admin` — sen (sahip). Her şeyi görür, düzenler, kilitler, açar.
- `store_manager` — mağaza müdürü. Sadece kendi mağaza(lar)ının verisini görür.
- `cashier` — kasiyer. Mağaza müdürü ile aynı haklar (MVP'de ayırmıyoruz, gerekirse sonra).
- `sales_rep` — satış temsilcisi. MVP'de pasif (placeholder).

### Many-to-many: kullanıcı ↔ mağaza
Bir kullanıcı birden fazla mağazaya bağlanabilir (`user_store_access` join table).

### Supabase RLS Politikaları (taslak)
```sql
-- Örnek: pos_slips tablosu
CREATE POLICY pos_slips_read ON pos_slips
  FOR SELECT
  USING (
    auth.jwt() ->> 'role' = 'admin'
    OR daily_record_id IN (
      SELECT id FROM daily_records
      WHERE store_id IN (
        SELECT store_id FROM user_store_access
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY pos_slips_write ON pos_slips
  FOR INSERT
  WITH CHECK (
    -- store_manager/cashier sadece kendi mağazasına ve günü kilitli değilse yazabilir
    EXISTS (
      SELECT 1 FROM daily_records dr
      JOIN user_store_access usa ON usa.store_id = dr.store_id
      WHERE dr.id = daily_record_id
        AND dr.status != 'locked'
        AND usa.user_id = auth.uid()
    )
  );
```

Tüm `uploads`, `expenses`, `bank_receipts`, `store_summaries`, `cash_advances`, `verifications` tablolarında aynı pattern.

### Admin Override
Admin için RLS bypass için `service_role` key sadece backend'de kullanılır. Frontend hiçbir zaman service_role kullanmaz.

---

## 5. OCR Pipeline Detayı

### Adım 1 — Preprocess (sharp)
```ts
const buf = await sharp(originalBuffer)
  .rotate()                        // EXIF orientation
  .normalize()                     // contrast
  .resize({ width: 2000, withoutEnlargement: true })
  .jpeg({ quality: 85 })
  .toBuffer();
```

### Adım 2 — Type-specific Claude prompt
Her upload type için özel system prompt + JSON schema. Örnek POS slip:

```
SYSTEM: Sen bir POS slip OCR uzmanısın. Sadece JSON döndür, açıklama yapma.

USER: [image]
Çıkar: { bank_name, terminal_no, date (ISO), sales_count, sales_amount,
        refund_count, refund_amount, net_amount, currency }
Okuyamadığın alan için null döndür. ASLA tahmin etme.
```

### Adım 3 — Zod validation
```ts
const PosSlipSchema = z.object({
  bank_name: z.string().nullable(),
  terminal_no: z.string().nullable(),
  date: z.string().date().nullable(),
  sales_count: z.number().int().nullable(),
  sales_amount: z.number().nullable(),
  refund_count: z.number().int().nullable(),
  refund_amount: z.number().nullable(),
  net_amount: z.number().nullable(),
  currency: z.enum(['TRY','USD','EUR','GBP']).default('TRY'),
});
```

### Adım 4 — Persist
- `uploads.raw_ocr_json` ← Claude'un ham çıktısı
- `uploads.parsed_data_json` ← zod ile validate edilmiş hali
- `pos_slips` ← normalized kolonlar
- Kullanıcı UI'da "Şu rakam yanlış" diyebilir → `pos_slips` UPDATE + audit_log

### Maliyet tahmini
Günde 7 mağaza × 5 upload × ~$0.02 = **~$1/gün** Claude API. Aylık ~$30.
MVP'de 1 mağaza → ~$5/ay.

---

## 6. Doğrulama (Verification) Algoritması

```ts
// services/verification.ts
const TOLERANCE_TL = 5;

export function verifyDay(record: DailyRecord) {
  const posSum = record.pos_slips.reduce((s, p) => s + p.net_amount_try, 0);
  const cash  = record.store_summary?.cash_sales_try ?? 0;
  const loyal = record.store_summary?.loyalty_points_total_try ?? 0;
  const expected = posSum + cash + loyal;
  const actual   = record.store_summary?.sales_total_try ?? 0;
  const diff     = actual - expected;

  if (Math.abs(diff) <= TOLERANCE_TL) {
    return { status: 'match',    diff, color: 'green' };
  }
  return { status: 'mismatch', diff, color: 'red' };
}
```

**Ek doğrulamalar (Faz 5 sonrası):**
- Banka dekont tutarı ≈ store_summary.cash_sales (yine ±5 TL)
- POS slip tarihi ≠ daily_record.date → uyarı (yanlış güne yüklenmiş olabilir)

**Manuel override:**
Admin "fark kabul" derse → `verifications.status = 'manual_override'`, `notes` zorunlu, `verified_by = admin_user_id`.

---

## 7. Para Birimi Yönetimi

### TCMB FX Cache
```
GET https://www.tcmb.gov.tr/kurlar/today.xml  (her gün 15:30 sonrası)
→ Parse → fx_rates tablosuna INSERT (date, currency, rate_to_try, source='TCMB')
```

Cron: Vercel Cron Job, her gün 16:00 TRT.

### Conversion utility
```ts
export async function toTRY(amount: number, currency: string, date: Date): Promise<number> {
  if (currency === 'TRY') return amount;
  const rate = await getFXRate(currency, date);  // cache miss → fetch TCMB
  return amount * rate;
}
```

### Storage
Her finansal kolon için **iki kolon:**
- `amount` (original currency)
- `amount_try` (TRY karşılığı, kayıt anındaki kura göre)
- `currency` (TRY/USD/EUR/GBP)

Raporlama hep `amount_try` üzerinden.

---

## 8. Audit Log

**Kural:** Her INSERT/UPDATE/DELETE → `audit_log` tablosuna kayıt.

Prisma middleware ile generic:
```ts
prisma.$use(async (params, next) => {
  const result = await next(params);
  if (['create','update','delete'].includes(params.action)) {
    await prisma.auditLog.create({
      data: {
        user_id: getCurrentUserId(),
        action: params.action,
        entity_type: params.model,
        entity_id: result?.id,
        before_json: params.action !== 'create' ? oldRecord : null,
        after_json: result,
      },
    });
  }
  return result;
});
```

**Admin Audit Log sayfası** (Faz 7'de): kim, ne zaman, neyi değiştirdi listesi.

---

## 9. Sayfa Haritası (App Router)

| Route | Rol | Aşama |
|---|---|---|
| `/[locale]/login` | public | 2 |
| `/[locale]/(app)/admin` | admin | 3 — Yönetici Portalı |
| `/[locale]/(app)/verification` | admin | 5 — Doğrulama Sistemi |
| `/[locale]/(app)/revenues` | admin | 6 — Gelir Analizi |
| `/[locale]/(app)/expenses` | admin | 6 — Gider Analizi |
| `/[locale]/(app)/upload` | hepsi | 4 — Yükle ve Analiz Et |
| `/[locale]/(app)/history` | hepsi (kendi kapsamında) | 7 — İşlem Geçmişi |
| `/[locale]/(app)/contact` | hepsi | 7 — Bize Ulaşın |

---

## 10. Phase Planı (Master Prompt'tan)

| # | İçerik | Tahmini süre |
|---|---|---|
| **2** | Next.js iskelet + Supabase + Prisma + Auth (login/logout) | 4-6h |
| **3** | Yönetici Portalı (Marka/Mağaza/Çalışan CRUD) | 6-8h |
| **4** | Yükleme + OCR pipeline (5 kart, Claude API) | 12-16h |
| **5** | Doğrulama Sistemi (takvim, eşitlik, onay/kilit) | 8-10h |
| **6** | Gelir & Gider analiz dashboard'ları + Excel export | 10-12h |
| **7** | İşlem Geçmişi + audit log UI + i18n cilası + mobile responsive | 6-8h |
| **8** | Vercel + Supabase production deploy + smoke test | 2-4h |

**Toplam MVP:** ~50-65 saat geliştirme. Sıralı 1-2 hafta.

---

## 11. Güvenlik Checklist

- ✅ Anthropic API key SADECE backend'de (`process.env.ANTHROPIC_API_KEY`)
- ✅ Supabase service_role key SADECE backend (`process.env.SUPABASE_SERVICE_ROLE_KEY`)
- ✅ Frontend sadece `NEXT_PUBLIC_SUPABASE_ANON_KEY` görür
- ✅ Tüm dosyalar Supabase Storage signed URL (1 saat geçerli)
- ✅ RLS tüm tablolarda aktif
- ✅ Upload limit: 10MB, sadece `image/*` ve `application/pdf`
- ✅ API rate limit (upstash Redis veya Vercel Edge Config)
- ✅ Audit log değiştirilemez (kullanıcı silme/edit yok)
- ✅ Admin actions için confirmation modal

---

## 12. Açık Sorular (Aşama 2'de Cevaplanacak)

1. **Supabase project credential'ları** (URL + anon_key + service_role_key) → `.env.local`'e
2. **Anthropic API key** → `.env.local`'e
3. **GitHub repo URL** → `git remote add origin ...`
4. **Domain tercihi** (Aşama 8'de): docuflow-tr.app mı, başka subdomain mi?
5. **Test verisi klasörünün yolu** (Aşama 4 başında) → OCR tuning için
6. **Vercel team/personal hesap adı** (Aşama 8)
7. **Email gönderimi gerekiyor mu?** (kasiyere "günü kilitlendi" bildirimi gibi) — şimdilik HAYIR varsayıyorum

---

## 13. Ölçekleme Notları (MVP Sonrası)

- **7 mağaza geçişi:** RLS zaten hazır olduğu için sadece seed verisi ekle.
- **Multi-tenant SaaS dönüşümü:** `organization_id` kolonunu tüm tablolara ekleme migration'ı + RLS güncellemesi gerekir. 1-2 günlük iş.
- **OCR maliyeti:** Tesseract fallback eklenirse %60 maliyet düşüşü mümkün ama doğruluk %75-80'e düşer. Önerilmez.
- **Mobile native app (gelecekte):** API zaten var → React Native client kolay eklenir.

---

**Aşama 1 tamam. Onay bekleniyor → Aşama 2: iskelet kurulumu.**
