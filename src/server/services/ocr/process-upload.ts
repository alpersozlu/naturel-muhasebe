import "server-only";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { UPLOAD_BUCKET } from "@/lib/constants";
import { parsePosSlip } from "./parsers/pos-slip";

/**
 * Run OCR for the given upload and persist results.
 * Idempotent-ish: re-running overwrites parsed_data_json and reinserts
 * the type-specific row (for PosSlip we delete-then-create on the
 * upload_id unique).
 *
 * Status flow:
 *   pending → processing → parsed   (success)
 *   pending → processing → failed   (error)
 *
 * For unsupported types we leave status='pending' for now (Phase 4c).
 */
export async function processUpload(uploadId: string): Promise<void> {
  const upload = await prisma.upload.findUnique({ where: { id: uploadId } });
  if (!upload) return;

  // Only POS slips supported in Phase 4b
  if (upload.type !== "pos_slip") return;

  await prisma.upload.update({
    where: { id: uploadId },
    data: { status: "processing", error_message: null },
  });

  // Download from Storage
  const supabase = createAdminClient();
  const { data: blob, error: dlErr } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .download(upload.file_url);
  if (dlErr || !blob) {
    await prisma.upload.update({
      where: { id: uploadId },
      data: {
        status: "failed",
        error_message: `Storage download failed: ${dlErr?.message ?? "no blob"}`,
      },
    });
    return;
  }
  const buffer = Buffer.from(await blob.arrayBuffer());

  try {
    const { raw, parsed } = await parsePosSlip({
      buffer,
      mimeType: upload.mime_type,
    });

    await prisma.posSlip.upsert({
      where: { upload_id: upload.id },
      update: {
        bank_name: parsed.bank_name,
        terminal_no: parsed.terminal_no,
        slip_date: parsed.date ? new Date(`${parsed.date}T00:00:00.000Z`) : null,
        sales_count: parsed.sales_count,
        sales_amount: parsed.sales_amount,
        refund_count: parsed.refund_count,
        refund_amount: parsed.refund_amount,
        net_amount: parsed.net_amount,
        currency: parsed.currency,
        net_amount_try:
          parsed.currency === "TRY" ? parsed.net_amount : null,
      },
      create: {
        upload_id: upload.id,
        daily_record_id: upload.daily_record_id,
        bank_name: parsed.bank_name,
        terminal_no: parsed.terminal_no,
        slip_date: parsed.date ? new Date(`${parsed.date}T00:00:00.000Z`) : null,
        sales_count: parsed.sales_count,
        sales_amount: parsed.sales_amount,
        refund_count: parsed.refund_count,
        refund_amount: parsed.refund_amount,
        net_amount: parsed.net_amount,
        currency: parsed.currency,
        net_amount_try:
          parsed.currency === "TRY" ? parsed.net_amount : null,
      },
    });

    await prisma.upload.update({
      where: { id: uploadId },
      data: {
        status: "parsed",
        raw_ocr_json: raw as object,
        parsed_data_json: parsed as object,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[OCR] failed", { uploadId, error: msg });
    await prisma.upload.update({
      where: { id: uploadId },
      data: {
        status: "failed",
        error_message: msg.slice(0, 1000),
      },
    });
  }
}
