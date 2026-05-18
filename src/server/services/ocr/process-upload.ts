import "server-only";
import type { Prisma, Upload } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { UPLOAD_BUCKET } from "@/lib/constants";
import { parsePosSlip } from "./parsers/pos-slip";
import { parseStoreSummary } from "./parsers/store-summary";
import { parseBankReceipt } from "./parsers/bank-receipt";
import { parseExpense } from "./parsers/expense";

const SUPPORTED = new Set<Upload["type"]>([
  "pos_slip",
  "store_summary",
  "bank_receipt",
  "expense",
]);

/**
 * Run OCR for the given upload and persist results.
 * Status: pending → processing → parsed | failed
 *
 * cash_advance is form-based, no OCR.
 */
export async function processUpload(uploadId: string): Promise<void> {
  const upload = await prisma.upload.findUnique({ where: { id: uploadId } });
  if (!upload) return;
  if (!SUPPORTED.has(upload.type)) return;

  await prisma.upload.update({
    where: { id: uploadId },
    data: { status: "processing", error_message: null },
  });

  const buffer = await downloadUpload(upload);
  if (!buffer) return;

  try {
    if (upload.type === "pos_slip") await runPosSlip(upload, buffer);
    else if (upload.type === "store_summary") await runStoreSummary(upload, buffer);
    else if (upload.type === "bank_receipt") await runBankReceipt(upload, buffer);
    else if (upload.type === "expense") await runExpense(upload, buffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[OCR] failed", { uploadId, type: upload.type, error: msg });
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "failed", error_message: msg.slice(0, 1000) },
    });
  }
}

async function downloadUpload(upload: Upload): Promise<Buffer | null> {
  const supabase = createAdminClient();
  const { data: blob, error } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .download(upload.file_url);
  if (error || !blob) {
    await prisma.upload.update({
      where: { id: upload.id },
      data: {
        status: "failed",
        error_message: `Storage download failed: ${error?.message ?? "no blob"}`,
      },
    });
    return null;
  }
  return Buffer.from(await blob.arrayBuffer());
}

async function runPosSlip(upload: Upload, buffer: Buffer): Promise<void> {
  const { raw, parsed } = await parsePosSlip({ buffer, mimeType: upload.mime_type });
  const fields = {
    bank_name: parsed.bank_name,
    terminal_no: parsed.terminal_no,
    slip_date: parsed.date ? new Date(`${parsed.date}T00:00:00.000Z`) : null,
    sales_count: parsed.sales_count,
    sales_amount: parsed.sales_amount,
    refund_count: parsed.refund_count,
    refund_amount: parsed.refund_amount,
    net_amount: parsed.net_amount,
    currency: parsed.currency,
    net_amount_try: parsed.currency === "TRY" ? parsed.net_amount : null,
  };
  await prisma.posSlip.upsert({
    where: { upload_id: upload.id },
    update: fields,
    create: { upload_id: upload.id, daily_record_id: upload.daily_record_id, ...fields },
  });
  await markParsed(upload.id, raw, parsed);
}

async function runStoreSummary(upload: Upload, buffer: Buffer): Promise<void> {
  const { raw, parsed } = await parseStoreSummary({
    buffer,
    mimeType: upload.mime_type,
  });
  const tryFor = (v: number | null) => (parsed.currency === "TRY" ? v : null);
  const fields = {
    sales_total: parsed.sales_total,
    cash_sales: parsed.cash_sales,
    credit_card_total: parsed.credit_card_total,
    loyalty_points_total: parsed.loyalty_points_total,
    opening_balance: parsed.opening_balance,
    closing_balance: parsed.closing_balance,
    currency: parsed.currency,
    sales_total_try: tryFor(parsed.sales_total),
    cash_sales_try: tryFor(parsed.cash_sales),
    credit_card_total_try: tryFor(parsed.credit_card_total),
    loyalty_points_total_try: tryFor(parsed.loyalty_points_total),
  };
  await prisma.storeSummary.upsert({
    where: { upload_id: upload.id },
    update: fields,
    create: { upload_id: upload.id, daily_record_id: upload.daily_record_id, ...fields },
  });
  await markParsed(upload.id, raw, parsed);
}

async function runBankReceipt(upload: Upload, buffer: Buffer): Promise<void> {
  const { raw, parsed } = await parseBankReceipt({
    buffer,
    mimeType: upload.mime_type,
  });
  if (parsed.amount === null || parsed.deposit_date === null) {
    throw new Error(
      "Banka dekontundan tutar veya tarih okunamadı — manuel düzenleme gerekli"
    );
  }
  const amount_try = parsed.currency === "TRY" ? parsed.amount : parsed.amount; // FX Phase 5
  const fields = {
    bank_name: parsed.bank_name,
    iban: parsed.iban,
    amount: parsed.amount,
    currency: parsed.currency,
    amount_try,
    deposit_date: new Date(`${parsed.deposit_date}T00:00:00.000Z`),
    is_manual: false,
  };
  await prisma.bankReceipt.upsert({
    where: { upload_id: upload.id },
    update: fields,
    create: { upload_id: upload.id, daily_record_id: upload.daily_record_id, ...fields },
  });
  await markParsed(upload.id, raw, parsed);
}

async function runExpense(upload: Upload, buffer: Buffer): Promise<void> {
  const { raw, parsed } = await parseExpense({ buffer, mimeType: upload.mime_type });
  if (parsed.amount === null || parsed.expense_date === null) {
    throw new Error(
      "Faturadan tutar veya tarih okunamadı — manuel düzenleme gerekli"
    );
  }
  const amount_try = parsed.currency === "TRY" ? parsed.amount : parsed.amount; // FX Phase 5
  const fields = {
    category: parsed.category,
    vendor: parsed.vendor,
    amount: parsed.amount,
    currency: parsed.currency,
    amount_try,
    expense_date: new Date(`${parsed.expense_date}T00:00:00.000Z`),
    description: parsed.description,
    vat_rate: parsed.vat_rate,
    vat_included: parsed.vat_included,
  };
  await prisma.expense.upsert({
    where: { upload_id: upload.id },
    update: fields,
    create: { upload_id: upload.id, daily_record_id: upload.daily_record_id, ...fields },
  });
  await markParsed(upload.id, raw, parsed);
}

async function markParsed(
  uploadId: string,
  raw: unknown,
  parsed: unknown
): Promise<void> {
  await prisma.upload.update({
    where: { id: uploadId },
    data: {
      status: "parsed",
      raw_ocr_json: raw as Prisma.InputJsonValue,
      parsed_data_json: parsed as Prisma.InputJsonValue,
    },
  });
}
