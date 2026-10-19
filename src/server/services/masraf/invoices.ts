import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { downloadFromStorage, uploadBufferToStorage } from "@/server/services/storage";
import { parseExpense } from "@/server/services/ocr/parsers/expense";
import { resolveDocumentDate } from "@/server/services/ocr/resolve-doc-date";
import { convertToTRY } from "@/server/services/fx/kktcmb";
import { categorizeExpense } from "@/lib/masraf/categorize";
import { matchInvoiceToExpenses, sameInvoice, type ExpenseCandidate, type InvoiceLike } from "./invoice-match";

/**
 * SAHİBİNİN FATURA FOTOĞRAFLARI (Faz 7, 19.10.2026)
 *
 * Akış: yükle (storage + satır, ocr_status=pending) → oku (OCR: satıcı, tarih,
 * belge no, tutar, KDV, kategori) → eşleştir (mağazanın yüklediği Expense ile)
 * → sınıfla: store (mağaza faturası, kasada sayıldı) | company (şirket faturası,
 * ÷7) | duplicate (aynı faturanın ikinci fotoğrafı) | excluded (yönetici çıkardı).
 *
 * Yönetici kararı (decided_by dolu) otomatik yeniden eşleştirmede EZİLMEZ.
 */

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" };
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

const AY_PARSE: [RegExp, number][] = [
  [/ocak/i, 1], [/[şs]ubat/i, 2], [/mart/i, 3], [/nisan/i, 4], [/may[ıi]s/i, 5], [/haziran/i, 6],
  [/temmuz/i, 7], [/a[ğg]ustos/i, 8], [/eyl[üu]l/i, 9], [/ekim/i, 10], [/kas[ıi]m/i, 11], [/aral[ıi]k/i, 12],
];
export function monthFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  for (const [re, m] of AY_PARSE) if (re.test(text)) return m;
  return null;
}

export type StoredFile = { name: string; mime_type: string; base64: string };

/**
 * Dosyaları storage'a + MasrafInvoice satırına yazar. Aynı dosya (SHA-256) ikinci
 * kez alınmaz. Mağaza AYNI dosyayı "Yükle ve Analiz Et"te yüklediyse OCR'a gerek
 * yok: doğrudan o masraf kaydına bağlanır (mağaza faturası).
 */
export async function storeInvoiceFiles(prisma: PrismaClient, files: StoredFile[], by: string, year: number, month: number) {
  const created: string[] = [];
  const linked: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const f of files) {
    const buffer = Buffer.from(f.base64, "base64");
    if (buffer.length < 1000) {
      skipped.push({ name: f.name, reason: "boş / bozuk dosya" });
      continue;
    }
    const hash = createHash("sha256").update(buffer).digest("hex");
    const dup = await prisma.masrafInvoice.findUnique({ where: { file_hash: hash } });
    if (dup) {
      if (dup.deleted_at) {
        await prisma.masrafInvoice.update({ where: { id: dup.id }, data: { deleted_at: null, period_year: year, period_month: month } });
        created.push(dup.id);
      } else skipped.push({ name: f.name, reason: `zaten yüklü${dup.vendor ? ` (${dup.vendor})` : ""}` });
      continue;
    }
    const path = `masraf-invoices/${year}-${String(month).padStart(2, "0")}/${randomUUID()}.${EXT[f.mime_type] ?? "bin"}`;
    await uploadBufferToStorage({ path, buffer, mimeType: f.mime_type });

    // Mağaza aynı dosyayı yüklemiş mi? (birebir aynı fotoğraf — WhatsApp'tan gelen)
    const sameUpload = await prisma.upload.findFirst({
      where: { file_hash: hash, type: "expense", status: { not: "failed" } },
      select: { expense: { select: { id: true, vendor: true, document_no: true, expense_date: true, amount_try: true, amount: true, currency: true, category: true, description: true, vat_rate: true } } },
    });
    const ex = sameUpload?.expense ?? null;
    const row = await prisma.masrafInvoice.create({
      data: {
        period_year: year,
        period_month: month,
        storage_path: path,
        mime_type: f.mime_type,
        file_hash: hash,
        file_size_bytes: buffer.length,
        source_name: f.name,
        uploaded_by: by,
        ...(ex
          ? {
              ocr_status: "done",
              vendor: ex.vendor,
              document_no: ex.document_no,
              expense_date: ex.expense_date,
              amount_original: ex.amount,
              currency: ex.currency,
              amount_try: ex.amount_try,
              vat_rate: ex.vat_rate,
              description: ex.description,
              ocr_category: ex.category,
              category: categorizeExpense({ category: ex.category, vendor: ex.vendor, description: ex.description }).category,
              auto_category: categorizeExpense({ category: ex.category, vendor: ex.vendor, description: ex.description }).category,
              classification: "store",
              matched_expense_id: ex.id,
              match_method: "file_hash",
              match_score: 1,
            }
          : {}),
      },
    });
    (ex ? linked : created).push(row.id);
  }
  return { created, linked, skipped };
}

/** Eşleştirme adayları: aynı tutar, ±3 gün (tarih yoksa seçilen ay ±1 ay). */
async function loadCandidates(prisma: PrismaClient, inv: { expense_date: Date | null; amount_try: number | null; period_year: number; period_month: number }): Promise<ExpenseCandidate[]> {
  if (inv.amount_try == null) return [];
  const from = inv.expense_date ? new Date(inv.expense_date.getTime() - 3 * DAY) : new Date(Date.UTC(inv.period_year, inv.period_month - 2, 1));
  const to = inv.expense_date ? new Date(inv.expense_date.getTime() + 3 * DAY) : new Date(Date.UTC(inv.period_year, inv.period_month + 1, 1));
  const rows = await prisma.expense.findMany({
    where: { expense_date: { gte: from, lte: to }, amount_try: { gte: inv.amount_try - 0.02, lte: inv.amount_try + 0.02 } },
    select: {
      id: true, vendor: true, document_no: true, expense_date: true, amount_try: true,
      upload: { select: { file_hash: true } },
      daily_record: { select: { store: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    store_name: r.daily_record.store.name,
    file_hash: r.upload?.file_hash ?? null,
    vendor: r.vendor,
    document_no: r.document_no && r.document_no !== "?" ? r.document_no : null,
    expense_date: iso(r.expense_date),
    amount_try: Number(r.amount_try),
  }));
}

type InvRow = NonNullable<Awaited<ReturnType<PrismaClient["masrafInvoice"]["findUnique"]>>>;

function toLike(r: InvRow): InvoiceLike {
  return { file_hash: r.file_hash, vendor: r.vendor, document_no: r.document_no, expense_date: r.expense_date ? iso(r.expense_date) : null, amount_try: r.amount_try == null ? null : Number(r.amount_try) };
}

/**
 * Bir faturayı mağaza kayıtları ve diğer fotoğraflarla eşleştirip sınıflar.
 * Yönetici kararı varsa (decided_by) ve force değilse dokunmaz.
 */
export async function classifyInvoice(prisma: PrismaClient, id: string, opts: { force?: boolean } = {}) {
  const inv = await prisma.masrafInvoice.findUniqueOrThrow({ where: { id } });
  if (inv.ocr_status !== "done" || inv.deleted_at) return inv;
  if (inv.decided_by && !opts.force) return inv;
  const like = toLike(inv);

  // 1) aynı faturanın başka fotoğrafı (önce yüklenen esas)
  const siblings = await prisma.masrafInvoice.findMany({
    where: { id: { not: inv.id }, deleted_at: null, ocr_status: "done", period_year: inv.period_year, classification: { in: ["store", "company"] }, uploaded_at: { lt: inv.uploaded_at } },
  });
  const twin = siblings.find((s) => sameInvoice(like, toLike(s)));
  if (twin) {
    return prisma.masrafInvoice.update({
      where: { id },
      data: { classification: "duplicate", duplicate_of_id: twin.id, matched_expense_id: null, match_method: null, match_score: null, decided_by: null },
    });
  }

  // 2) mağazanın yüklediği masraf kaydı
  const candidates = await loadCandidates(prisma, { expense_date: inv.expense_date, amount_try: like.amount_try, period_year: inv.period_year, period_month: inv.period_month });
  // başka bir fotoğrafa zaten bağlı kayıtlar bu fotoğrafla eşleşemez (ikinci fotoğraf = mükerrer)
  const taken = new Set(
    (await prisma.masrafInvoice.findMany({ where: { id: { not: inv.id }, deleted_at: null, matched_expense_id: { in: candidates.map((c) => c.id) } }, select: { matched_expense_id: true, id: true } })).map((t) => t.matched_expense_id!)
  );
  const free = candidates.filter((c) => !taken.has(c.id));
  const m = matchInvoiceToExpenses(like, free);
  if (m) {
    return prisma.masrafInvoice.update({
      where: { id },
      data: { classification: "store", matched_expense_id: m.expense.id, match_method: m.method, match_score: m.score, duplicate_of_id: null, decided_by: null },
    });
  }
  const takenMatch = matchInvoiceToExpenses(like, candidates.filter((c) => taken.has(c.id)));
  if (takenMatch) {
    const owner = await prisma.masrafInvoice.findFirst({ where: { matched_expense_id: takenMatch.expense.id, deleted_at: null, id: { not: inv.id } }, select: { id: true } });
    return prisma.masrafInvoice.update({
      where: { id },
      data: { classification: "duplicate", duplicate_of_id: owner?.id ?? null, matched_expense_id: null, match_method: null, match_score: null, decided_by: null },
    });
  }
  // 3) hiçbiri → şirket faturası
  return prisma.masrafInvoice.update({
    where: { id },
    data: { classification: "company", matched_expense_id: null, match_method: null, match_score: null, duplicate_of_id: null, decided_by: null },
  });
}

/** OCR + kategori + eşleştirme (istemci fotoğrafları tek tek okutur; Vercel 60 s). */
export async function readInvoice(prisma: PrismaClient, id: string) {
  const inv = await prisma.masrafInvoice.findUniqueOrThrow({ where: { id } });
  try {
    const buf = await downloadFromStorage(inv.storage_path);
    const { raw, parsed } = await parseExpense({ buffer: buf, mimeType: inv.mime_type });
    if (!parsed.is_expense) {
      return prisma.masrafInvoice.update({ where: { id }, data: { ocr_status: "failed", ocr_error: parsed.rejection_reason ?? "Bu bir fatura/makbuz gibi görünmüyor", ocr_json: raw as object } });
    }
    if (parsed.amount == null) {
      return prisma.masrafInvoice.update({ where: { id }, data: { ocr_status: "failed", ocr_error: "Faturadan tutar okunamadı — fotoğrafı daha yakından, düz çekin", ocr_json: raw as object } });
    }
    const dateIso = resolveDocumentDate({ raw: parsed.expense_date_raw, modelIso: parsed.expense_date, expectedIso: null }).iso;
    const fx = await convertToTRY(parsed.amount, parsed.currency, dateIso ? utc(dateIso) : new Date());
    const cat = categorizeExpense({ category: parsed.category, vendor: parsed.vendor, description: parsed.description });
    const belongs = cat.category === "KIRA" ? monthFromText(parsed.description) ?? monthFromText(parsed.vendor) : null;
    await prisma.masrafInvoice.update({
      where: { id },
      data: {
        ocr_status: "done",
        ocr_error: fx.converted ? null : `${parsed.currency} kuru bulunamadı — TL tutarı elle gir`,
        ocr_json: raw as object,
        vendor: parsed.vendor,
        document_no: parsed.document_no ?? null,
        expense_date: dateIso ? utc(dateIso) : null,
        amount_original: parsed.amount,
        currency: parsed.currency,
        fx_rate: fx.converted && fx.rate !== 1 ? fx.rate : null,
        amount_try: fx.converted ? Math.round(fx.amountTRY * 100) / 100 : null,
        vat_rate: parsed.vat_rate,
        description: parsed.description,
        ocr_category: parsed.category,
        category: cat.category,
        auto_category: cat.category,
        needs_review: cat.needsReview || !dateIso || !fx.converted,
        belongs_month: belongs,
      },
    });
    return classifyInvoice(prisma, id);
  } catch (e) {
    return prisma.masrafInvoice.update({ where: { id }, data: { ocr_status: "failed", ocr_error: e instanceof Error ? e.message : String(e) } });
  }
}

/** Ayın tüm otomatik kararlı fotoğraflarını yeniden eşleştirir (mağaza sonradan yüklediyse). */
export async function rematchMonth(prisma: PrismaClient, year: number, month: number): Promise<{ checked: number; changed: number }> {
  const rows = await prisma.masrafInvoice.findMany({
    where: { period_year: year, period_month: month, deleted_at: null, ocr_status: "done", decided_by: null },
    select: { id: true, classification: true, matched_expense_id: true },
    orderBy: { uploaded_at: "asc" },
  });
  let changed = 0;
  for (const r of rows) {
    const after = await classifyInvoice(prisma, r.id);
    if (after.classification !== r.classification || after.matched_expense_id !== r.matched_expense_id) changed += 1;
  }
  return { checked: rows.length, changed };
}

/**
 * Mağaza yeni bir masraf fişi yükledi: sahibinin daha önce "şirket faturası"
 * saydığı bir fotoğraf aslında bu fiş olabilir → yeniden eşleştir. process-upload
 * sonundan çağrılır; hata yüklemeyi bozmaz.
 */
export async function relinkInvoicesForExpense(prisma: PrismaClient, expenseId: string): Promise<void> {
  try {
    const ex = await prisma.expense.findUnique({ where: { id: expenseId }, select: { expense_date: true, amount_try: true } });
    if (!ex) return;
    const amt = Number(ex.amount_try);
    const cands = await prisma.masrafInvoice.findMany({
      where: {
        deleted_at: null,
        ocr_status: "done",
        decided_by: null,
        classification: { in: ["company", "pending"] },
        amount_try: { gte: amt - 0.02, lte: amt + 0.02 },
        OR: [
          { expense_date: { gte: new Date(ex.expense_date.getTime() - 3 * DAY), lte: new Date(ex.expense_date.getTime() + 3 * DAY) } },
          { expense_date: null, period_year: ex.expense_date.getUTCFullYear() },
        ],
      },
      select: { id: true },
    });
    for (const c of cands) await classifyInvoice(prisma, c.id);
  } catch (e) {
    console.error("[masraf] relinkInvoicesForExpense failed", e instanceof Error ? e.message : e);
  }
}
