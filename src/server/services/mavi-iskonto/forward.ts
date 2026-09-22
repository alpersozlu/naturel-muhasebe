import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { UPLOAD_BUCKET } from "@/lib/constants";

/**
 * Hand the Mavi stores' "Bayi Gün Sonu" file to the discount-control system
 * (mavi-iskonto), where the owner used to upload the very same export by hand
 * under "Dosya Yükle → Satış Raporu".
 *
 * Nothing had to change on that side: POST /api/analiz takes the file as
 * `satis`, reads the store from the file's own "Mağaza" column (so each
 * store's upload lands on that store's data), and is idempotent — rows
 * already on file are skipped, so a repeated or overlapping hand-over is
 * harmless. Verified 2026-09-21 by running its parser on the live Lefkoşa
 * files of 18–19.09: right store (9400), right day, no warnings.
 *
 * Auth is that system's single-password header. The password is NOT in this
 * repository: it is read from MAVI_ISKONTO_PAROLA, set by the owner in the
 * hosting environment. Without it the hand-over is skipped, never an error.
 */
const BASE = (process.env.MAVI_ISKONTO_URL || "https://mavi-iskonto.onrender.com").replace(/\/$/, "");
const BUDGET_MS = 45_000; // stays inside the 60 s function limit

export function isIskontoConfigured(): boolean {
  return !!process.env.MAVI_ISKONTO_PAROLA?.trim();
}

export type ForwardResult = { status: "done" | "sent" | "failed" | "skipped"; detail: string; jobId?: string };

async function save(uploadId: string, r: ForwardResult): Promise<void> {
  await prisma.dealerDailyReport.updateMany({
    where: { upload_id: uploadId },
    data: {
      iskonto_status: r.status,
      iskonto_detail: r.detail.slice(0, 900),
      iskonto_job_id: r.jobId ?? null,
      iskonto_forwarded_at: r.status === "done" || r.status === "sent" ? new Date() : null,
    },
  });
}

/**
 * Pick up ONE report the hand-over has not reached yet — uploaded before
 * this existed, or failed on a transient error (discount system asleep or
 * busy) — and claim it. Sequential on purpose: the discount system accepts a
 * single analysis at a time (409 otherwise). Called from the upload list,
 * which every day view and the processing poll hit, so the backlog drains
 * without anyone pressing anything.
 */
export async function claimNextPendingForward(): Promise<string | null> {
  if (!isIskontoConfigured()) return null;
  const retryFailedBefore = new Date(Date.now() - 10 * 60_000);
  const staleSendingBefore = new Date(Date.now() - 5 * 60_000);
  const where: Prisma.DealerDailyReportWhereInput = {
    upload: { status: { in: ["parsed", "confirmed"] } },
    OR: [
      { iskonto_status: null },
      { iskonto_status: "failed", updated_at: { lt: retryFailedBefore } },
      // A hand-over cut off mid-way (function limit) never wrote its outcome.
      { iskonto_status: "sending", updated_at: { lt: staleSendingBefore } },
    ],
  };
  // One at a time means one at a time: while a hand-over is in flight, or
  // one was accepted in the last few minutes (its analysis is still running
  // over there), do not start the next — it would only collect a 409.
  const inFlight = await prisma.dealerDailyReport.count({
    where: {
      OR: [
        { iskonto_status: "sending", updated_at: { gte: staleSendingBefore } },
        { iskonto_status: "sent", updated_at: { gte: new Date(Date.now() - 4 * 60_000) } },
      ],
    },
  });
  if (inFlight > 0) return null;
  const next = await prisma.dealerDailyReport.findFirst({ where, orderBy: { report_date: "asc" }, select: { id: true, upload_id: true } });
  if (!next) return null;
  // Claim atomically: two concurrent polls must not both send the same file.
  const claimed = await prisma.dealerDailyReport.updateMany({
    where: { id: next.id, ...where },
    data: { iskonto_status: "sending", iskonto_detail: "Aktarılıyor…" },
  });
  return claimed.count === 1 ? next.upload_id : null;
}

/** Never throws; the outcome is stored on the dealer report. */
export async function forwardDealerReport(uploadId: string, file?: Buffer): Promise<ForwardResult> {
  const result = await attempt(uploadId, file).catch(
    (e): ForwardResult => ({ status: "failed", detail: e instanceof Error ? e.message : String(e) })
  );
  await save(uploadId, result).catch((e) => console.error("[iskonto] save failed", e));
  if (result.status === "failed") console.error("[iskonto] hand-over failed", { uploadId, detail: result.detail });
  return result;
}

async function attempt(uploadId: string, file?: Buffer): Promise<ForwardResult> {
  const password = process.env.MAVI_ISKONTO_PAROLA?.trim();
  if (!password) return { status: "skipped", detail: "MAVI_ISKONTO_PAROLA tanımlı değil — aktarım kapalı." };

  const report = await prisma.dealerDailyReport.findUnique({
    where: { upload_id: uploadId },
    include: { upload: true },
  });
  if (!report) return { status: "failed", detail: "Bayi raporu kaydı bulunamadı." };

  let buffer = file;
  if (!buffer) {
    const { data, error } = await createAdminClient().storage.from(UPLOAD_BUCKET).download(report.upload.file_url);
    if (error || !data) return { status: "failed", detail: `Dosya depodan alınamadı: ${error?.message ?? "boş"}` };
    buffer = Buffer.from(await data.arrayBuffer());
  }

  const started = Date.now();
  const left = () => BUDGET_MS - (Date.now() - started);
  const day = report.report_date.toISOString().slice(0, 10);
  const name = `bayi-gunsonu-${report.store_code ?? "magaza"}-${day}.xlsx`;
  const headers = { "X-Mavi-Parola": password };

  // 409 = another upload is being analysed there; wait and try again.
  let jobId: string | null = null;
  for (let tryNo = 1; tryNo <= 4 && left() > 8_000; tryNo++) {
    const form = new FormData();
    form.append(
      "satis",
      new Blob([new Uint8Array(buffer)], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      name
    );
    let res: Response;
    try {
      res = await fetch(`${BASE}/api/analiz`, {
        method: "POST",
        headers,
        body: form,
        signal: AbortSignal.timeout(Math.max(5_000, Math.min(35_000, left() - 3_000))),
      });
    } catch (e) {
      // Free hosting wakes up slowly; one more go if there is time.
      if (tryNo < 4 && left() > 15_000) continue;
      return { status: "failed", detail: `İndirim sistemine ulaşılamadı: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (res.status === 202 || res.status === 200) {
      const body = (await res.json().catch(() => ({}))) as { is_id?: string };
      jobId = body.is_id ?? null;
      break;
    }
    if (res.status === 409) {
      await sleep(Math.min(7_000, Math.max(1_000, left() - 9_000)));
      continue;
    }
    const text = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status === 401) return { status: "failed", detail: "İndirim sistemi parolayı kabul etmedi (MAVI_ISKONTO_PAROLA)." };
    return { status: "failed", detail: `İndirim sistemi ${res.status} döndü: ${text}` };
  }
  if (!jobId) return { status: "failed", detail: "İndirim sistemi meşguldü (başka bir yükleme sürüyor) — yeniden deneyin." };

  // The analysis runs in the background over there; follow it while the
  // budget lasts. "sent" = accepted, outcome not seen yet.
  while (left() > 4_000) {
    await sleep(3_000);
    try {
      const r = await fetch(`${BASE}/api/analiz/is-durumu/${jobId}`, { headers, signal: AbortSignal.timeout(8_000) });
      if (!r.ok) continue;
      const j = (await r.json()) as { durum?: string; hata?: unknown; sonuc?: Record<string, unknown> | null };
      if (j.durum === "tamam") return { status: "done", detail: summarise(j.sonuc), jobId };
      if (j.durum === "hata") return { status: "failed", detail: `İndirim sistemi dosyayı işleyemedi: ${String(j.hata).slice(0, 300)}`, jobId };
    } catch {
      // keep polling
    }
  }
  return { status: "sent", detail: "Dosya teslim edildi; indirim sistemi analizi sürdürüyor.", jobId };
}

function summarise(sonuc: Record<string, unknown> | null | undefined): string {
  if (!sonuc) return "İşlendi.";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(sonuc)) {
    if (typeof v === "number" || (typeof v === "string" && v.length < 40)) parts.push(`${k}=${v}`);
    if (parts.length >= 6) break;
  }
  return parts.length ? `İşlendi (${parts.join(", ")})` : "İşlendi.";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
