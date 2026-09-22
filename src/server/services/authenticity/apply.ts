import "server-only";
import type { Prisma, Upload } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isMailConfigured, sendMail } from "@/server/services/mail";
import { resolveAppBaseForMail } from "@/lib/app-url";
import { requestMeta } from "@/server/services/auth-events";
import { contextSignals, decide, type AuthenticityReport } from "./assess";
import type { FileForensics } from "./file-forensics";
import type { VisionCheck } from "./vision-check";

/** Shown to the uploader. Deliberately says nothing about HOW it was noticed. */
export const SYNTHETIC_MESSAGE =
  "Bu görsel, belgenin kendi fotoğrafı olarak doğrulanamadı. Belgenin aslını telefonla çekip yeniden yükleyin. Yöneticiniz bilgilendirildi.";

const TYPE_LABEL: Record<string, string> = {
  pos_slip: "POS gün sonu slibi",
  z_report: "Z raporu",
  store_summary: "Mağaza özeti",
  bank_receipt: "Banka dekontu",
  expense: "Masraf fişi",
};

/**
 * Phase 2 + consequences. Called after OCR has finished (whatever its
 * outcome) with the phase-1 findings. Never throws.
 */
export async function applyAuthenticity(
  upload: Upload,
  phase1: { file: FileForensics; vision: VisionCheck | null } | null
): Promise<AuthenticityReport | null> {
  if (!phase1) return null;
  try {
    const context = await contextSignals(prisma, upload);
    const report = decide({ type: upload.type, file: phase1.file, vision: phase1.vision, context });

    await prisma.upload.update({
      where: { id: upload.id },
      data: {
        authenticity_verdict: report.level,
        authenticity_json: report as unknown as Prisma.InputJsonValue,
        authenticity_checked_at: new Date(),
      },
    });

    if (report.level === "synthetic") {
      // Whatever OCR wrote must not count towards the day.
      await prisma.$transaction([
        prisma.posSlip.deleteMany({ where: { upload_id: upload.id } }),
        prisma.storeSummary.deleteMany({ where: { upload_id: upload.id } }),
        prisma.bankReceipt.deleteMany({ where: { upload_id: upload.id } }),
        prisma.expense.deleteMany({ where: { upload_id: upload.id } }),
        prisma.zReport.deleteMany({ where: { upload_id: upload.id } }),
        prisma.upload.update({ where: { id: upload.id }, data: { status: "failed", error_message: SYNTHETIC_MESSAGE } }),
      ]);
    }
    if (report.level !== "ok") await notifyAdmins(upload, report);
    return report;
  } catch (e) {
    console.error("[authenticity] apply failed", e instanceof Error ? e.message : e);
    return null;
  }
}

async function notifyAdmins(upload: Upload, report: AuthenticityReport): Promise<void> {
  try {
    if (!isMailConfigured()) return;
    const [dr, uploader, admins] = await Promise.all([
      prisma.dailyRecord.findUnique({ where: { id: upload.daily_record_id }, include: { store: true } }),
      prisma.user.findUnique({ where: { id: upload.uploaded_by }, select: { full_name: true, email: true } }),
      prisma.user.findMany({ where: { role: "admin", is_active: true, deleted_at: null }, select: { email: true } }),
    ]);
    if (!dr || admins.length === 0) return;
    const day = dr.date.toISOString().slice(0, 10);
    const dayTr = day.split("-").reverse().join(".");
    const kind = TYPE_LABEL[upload.type] ?? upload.type;
    const headline =
      report.level === "synthetic"
        ? "Üretilmiş görsel reddedildi"
        : "Şüpheli belge: incelemenizi bekliyor";
    let link = "";
    try {
      link = `${await resolveAppBaseForMail(requestMeta().host)}/tr/upload?store=${dr.store_id}&date=${day}`;
    } catch {
      link = "";
    }
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const lines = [
      `${headline}`,
      "",
      `Mağaza: ${dr.store.name}`,
      `Gün: ${dayTr}`,
      `Belge: ${kind}`,
      `Yükleyen: ${uploader?.full_name ?? uploader?.email ?? "?"}`,
      "",
      "Nedenler:",
      ...report.reasons.map((r) => `- ${r}`),
      "",
      report.level === "synthetic"
        ? "Belge güne SAYILMADI. Mağazadan belgenin aslının fotoğrafını isteyin."
        : "Belge güne sayıldı ama işaretlendi; siz incelemeden müdür günü kilitleyemez.",
      link ? `\n${link}` : "",
    ];
    const html = `<div style="margin:0;padding:32px 16px;background:#f6f6f7;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
      <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
        <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">Naturel Ticaret · Belge denetimi</p>
        <h1 style="margin:0 0 16px;font-size:20px;color:#111827">${esc(headline)}</h1>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#374151">
          <b>${esc(dr.store.name)}</b> · ${esc(dayTr)} · ${esc(kind)}<br/>Yükleyen: ${esc(uploader?.full_name ?? uploader?.email ?? "?")}
        </p>
        <ul style="margin:0 0 18px;padding-left:18px;font-size:14px;line-height:1.6;color:#111827">${report.reasons
          .map((r) => `<li>${esc(r)}</li>`)
          .join("")}</ul>
        <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#6b7280">${esc(lines[lines.length - 2] ?? "")}</p>
        ${link ? `<p style="margin:0"><a href="${esc(link)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">Günü aç</a></p>` : ""}
      </div></div>`;
    await Promise.allSettled(
      admins.map((a) =>
        sendMail({ to: a.email, subject: `Belge denetimi: ${dr.store.name} ${dayTr} — ${headline}`, text: lines.join("\n"), html })
      )
    );
  } catch (e) {
    console.error("[authenticity] notify failed", e instanceof Error ? e.message : e);
  }
}
