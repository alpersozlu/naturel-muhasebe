import "server-only";
import { createHash } from "node:crypto";
import type { Prisma, Upload } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { UPLOAD_BUCKET } from "@/lib/constants";
import { parsePosSlip } from "./parsers/pos-slip";
import { parseStoreSummary } from "./parsers/store-summary";
import { parseBankReceipt } from "./parsers/bank-receipt";
import { parseExpense } from "./parsers/expense";
import { parseZReport } from "./parsers/z-report";

const SUPPORTED = new Set<Upload["type"]>([
  "pos_slip",
  "store_summary",
  "bank_receipt",
  "expense",
  "z_report",
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
    else if (upload.type === "z_report") await runZReport(upload, buffer);
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

  // Fingerprint over content-defining fields. If two photos of the
  // same slip get uploaded, they all collapse to the same fingerprint.
  const fingerprint = parsed.bank_name
    ? createHash("sha256")
        .update(
          [
            parsed.bank_name ?? "",
            parsed.terminal_no ?? "",
            parsed.date ?? "",
            String(parsed.net_amount ?? ""),
            String(parsed.sales_count ?? ""),
          ].join("|")
        )
        .digest("hex")
    : null;

  // 🛡️ Fraud guard #2: content replay. Same slip captured as a
  // different photo (different file hash) but identical OCR fields.
  if (fingerprint) {
    const dup = await prisma.posSlip.findFirst({
      where: {
        daily_record_id: upload.daily_record_id,
        content_fingerprint: fingerprint,
        NOT: { upload_id: upload.id },
      },
      select: { upload_id: true },
    });
    if (dup) {
      await prisma.upload.update({
        where: { id: upload.id },
        data: {
          status: "failed",
          duplicate_of_id: dup.upload_id,
          error_message:
            "Bu slip'in içeriği bu güne zaten kayıtlı — aynı banka, terminal, tutar. Önce mevcut kaydı silin.",
        },
      });
      return;
    }
  }

  // Date mismatch detection (warn, don't block).
  const dr = await prisma.dailyRecord.findUnique({
    where: { id: upload.daily_record_id },
    select: { date: true },
  });
  const expectedDateIso = dr ? dr.date.toISOString().slice(0, 10) : null;
  const dateMismatch =
    !!parsed.date && !!expectedDateIso && parsed.date !== expectedDateIso;

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
    content_fingerprint: fingerprint,
  };
  await prisma.posSlip.upsert({
    where: { upload_id: upload.id },
    update: fields,
    create: { upload_id: upload.id, daily_record_id: upload.daily_record_id, ...fields },
  });

  if (dateMismatch) {
    await prisma.upload.update({
      where: { id: upload.id },
      data: { date_mismatch: true },
    });
  }

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

async function runZReport(upload: Upload, buffer: Buffer): Promise<void> {
  const { raw, parsed } = await parseZReport({
    buffer,
    mimeType: upload.mime_type,
  });

  // Content fingerprint: bank/terminal yok ama report_no + date + amounts var
  const fingerprint = parsed.report_no
    ? createHash("sha256")
        .update(
          [
            parsed.report_no ?? "",
            parsed.report_date ?? "",
            String(parsed.net_sales ?? ""),
            String(parsed.credit_card_sales ?? ""),
            String(parsed.cash_sales ?? ""),
          ].join("|")
        )
        .digest("hex")
    : null;

  // Fraud guard #2: same Z replay (different photo, same content)
  if (fingerprint) {
    const dup = await prisma.zReport.findFirst({
      where: {
        daily_record_id: upload.daily_record_id,
        content_fingerprint: fingerprint,
        NOT: { upload_id: upload.id },
      },
      select: { upload_id: true },
    });
    if (dup) {
      await prisma.upload.update({
        where: { id: upload.id },
        data: {
          status: "failed",
          duplicate_of_id: dup.upload_id,
          error_message:
            "Bu Z raporunun içeriği bu güne zaten kayıtlı — aynı Z numarası, tarih ve tutarlar. Önce mevcut kaydı silin.",
        },
      });
      return;
    }
  }

  // Date mismatch warning
  const dr = await prisma.dailyRecord.findUnique({
    where: { id: upload.daily_record_id },
    select: { date: true },
  });
  const expectedDateIso = dr ? dr.date.toISOString().slice(0, 10) : null;
  const dateMismatch =
    !!parsed.report_date &&
    !!expectedDateIso &&
    parsed.report_date !== expectedDateIso;

  // Net sales: yoksa gross
  const net = parsed.net_sales ?? parsed.gross_sales;
  const tryFor = (v: number | null) => (parsed.currency === "TRY" ? v : null);

  const fields = {
    report_no: parsed.report_no,
    report_date: parsed.report_date
      ? new Date(`${parsed.report_date}T00:00:00.000Z`)
      : null,
    gross_sales: parsed.gross_sales,
    net_sales: net,
    cash_sales: parsed.cash_sales,
    credit_card_sales: parsed.credit_card_sales,
    refund_amount: parsed.refund_amount,
    vat_total: parsed.vat_total,
    currency: parsed.currency,
    gross_sales_try: tryFor(parsed.gross_sales),
    net_sales_try: tryFor(net),
    cash_sales_try: tryFor(parsed.cash_sales),
    credit_card_sales_try: tryFor(parsed.credit_card_sales),
    content_fingerprint: fingerprint,
  };
  await prisma.zReport.upsert({
    where: { upload_id: upload.id },
    update: fields,
    create: {
      upload_id: upload.id,
      daily_record_id: upload.daily_record_id,
      ...fields,
    },
  });

  if (dateMismatch) {
    await prisma.upload.update({
      where: { id: upload.id },
      data: { date_mismatch: true },
    });
  }

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
