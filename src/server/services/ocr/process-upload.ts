import "server-only";
import { resolveDocumentDate } from "./resolve-doc-date";
import { missingVoucherSerials } from "@/server/services/nebim/voucher-snapshot";
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
import { ASSESSED_TYPES, bankKey, inspectUpload } from "@/server/services/authenticity/assess";
import { resolveBankFromTerminalHistory } from "./bank-from-terminal";
import { applyAuthenticity } from "@/server/services/authenticity/apply";
import { forwardDealerReport } from "@/server/services/mavi-iskonto/forward";
import { saveReportReps } from "@/server/services/dealer-report/daily-reps";
import { isSapOriginal, xlsxOrigin } from "@/server/services/xlsx-origin";
import { reconcileExtraRowsWithSap } from "./extra-rows";
import {
  parseMaviSapBuffer,
  pickDay,
  mergedDealerDay,
  dealerReportFingerprint,
  MAVI_STORE_CODE_MAP,
} from "@/server/services/dealer-report/mavi-sap-parser";

const SUPPORTED = new Set<Upload["type"]>([
  "pos_slip",
  "store_summary",
  "bank_receipt",
  "expense",
  "z_report",
  "dealer_daily_report",
]);

function fmtDateTr(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

/**
 * Türkçe karakterleri ASCII'ye çevir, lowercase yap. Fuzzy mağaza ismi
 * karşılaştırması için ("Güzelyurt" ↔ "GÜZELYURT" ↔ "guzelyurt").
 */
function normalizeName(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Hard date enforcement: belge tarihi seçili güne eşleşmek zorunda.
 * Belge tarihi okunamazsa veya farklıysa hata fırlatır → upload "failed" olur.
 */
/** Hata mesajlarında tutarı Türkçe biçimde göster. */
function fmtMoneyTr(v: number): string {
  return v.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Belge tarihinin yüklendiği günle aynı olduğunu doğrular.
 * Sırayla: belgedeki HAM metnin GG-AA-YY çözümü → modelin ISO'su → gün/yıl
 * takası. Biri tutarsa o tarih kullanılır; hiçbiri tutmazsa hata verilir.
 * Dönen değer: kullanılacak (gerekirse düzeltilmiş) tarih.
 */
async function assertDateMatch(
  dailyRecordId: string,
  docDate: string | null,
  docLabel: string,
  docDateRaw?: string | null
): Promise<string> {
  const dr = await prisma.dailyRecord.findUnique({
    where: { id: dailyRecordId },
    select: { date: true },
  });
  const expectedIso = dr ? dr.date.toISOString().slice(0, 10) : null;

  const r = resolveDocumentDate({ raw: docDateRaw, modelIso: docDate, expectedIso });

  if (r.iso === null) {
    throw new Error(
      `${docLabel} tarihi okunamadı — manuel kontrol gerekli. Lütfen tarihi okunaklı olan bir görsel yükleyin.`
    );
  }
  if (expectedIso && !r.matches) {
    throw new Error(
      `${docLabel} ${fmtDateTr(r.iso)} tarihli, ama ${fmtDateTr(
        expectedIso
      )} gününe yüklenmeye çalışıldı. Doğru güne yükleyin.`
    );
  }
  return r.iso;
}

// ── Replay guard (content) ────────────────────────────────────────────────
// The same document must not be counted twice. The exact-file guard sits in
// upload.create; these catch a SECOND PHOTO of the same paper — anywhere in
// the store's history, not only on the same day (owner, 28.09.2026: "aynı
// şeyi iki kere yüklemelerine izin verme"). A merged day, a slip pushed to
// the next day, a Z re-shot a week later: all land here.
type DupScope = { store_id: string };
async function dupScope(upload: Upload): Promise<DupScope> {
  const dr = await prisma.dailyRecord.findUnique({
    where: { id: upload.daily_record_id },
    select: { store_id: true },
  });
  return { store_id: dr?.store_id ?? "" };
}
/**
 * Two readings of one paper differ in small ways (an IBAN with or without
 * spaces, a vendor name read once and missed once). Same date + amount is
 * the anchor; an identity field only SEPARATES documents when both readings
 * have it and they disagree.
 */
function sameIdentity(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (v: string) => v.toLocaleUpperCase("tr").replace(/[^A-Z0-9ÇĞİÖŞÜ]/g, "");
  if (!a || !b) return true;
  const x = norm(a), y = norm(b);
  if (!x || !y) return true;
  return x === y || x.startsWith(y) || y.startsWith(x);
}
/** Admin said "this is a different document" (upload.acceptAsDistinct). */
function duplicateCheckSkipped(upload: Upload): boolean {
  return !!(upload.user_meta_json as { skip_duplicate_check?: boolean } | null)?.skip_duplicate_check;
}
/** Fail the upload as a replay of `dupUploadId`; the message names the day it already sits on. */
async function failAsDuplicate(upload: Upload, dupUploadId: string, what: string): Promise<void> {
  const prev = await prisma.upload.findUnique({
    where: { id: dupUploadId },
    select: { uploaded_at: true, daily_record: { select: { date: true } } },
  });
  const day = prev ? fmtDateTr(prev.daily_record.date.toISOString().slice(0, 10)) : "?";
  const at = prev ? prev.uploaded_at.toLocaleString("tr-TR", { timeZone: "Europe/Nicosia" }) : "";
  await prisma.upload.update({
    where: { id: upload.id },
    data: {
      status: "failed",
      duplicate_of_id: dupUploadId,
      error_message:
        `${what} zaten yüklü — ${day} gününe kayıtlı${at ? ` (${at})` : ""}. ` +
        "Aynı belge ikinci kez yüklenemez; bu yüklemeyi silin. Belge gerçekten farklıysa yöneticinize söyleyin.",
    },
  });
}

/**
 * Run OCR for the given upload and persist results.
 * Status: pending → processing → parsed | failed
 *
 * cash_advance is form-based, no OCR.
 */
export async function processUpload(
  uploadId: string,
  opts: { /** re-read only: do not hand the dealer file to the discount system again */ skipForward?: boolean } = {}
): Promise<void> {
  const upload = await prisma.upload.findUnique({ where: { id: uploadId } });
  if (!upload) return;
  if (!SUPPORTED.has(upload.type)) return;

  await prisma.upload.update({
    where: { id: uploadId },
    data: { status: "processing", error_message: null },
  });

  // Authenticity screening runs ALONGSIDE the OCR call (no extra wall-clock)
  // and is applied once OCR has finished, whatever its outcome. An admin who
  // reviewed and accepted a document ("cleared") is not second-guessed.
  let screening: ReturnType<typeof inspectUpload> | null = null;

  try {
    const buffer = await downloadUpload(upload);
    if (!buffer) {
      // Eskiden sessizce dönüyordu → kayıt sonsuza kadar "processing" kalıyordu.
      throw new Error("Dosya depodan indirilemedi. Lütfen tekrar yükleyin.");
    }
    if (ASSESSED_TYPES.has(upload.type) && upload.authenticity_verdict !== "cleared") {
      screening = inspectUpload({ buffer, mimeType: upload.mime_type });
      screening.catch(() => undefined); // awaited below; never an unhandled rejection
    }
    if (upload.type === "pos_slip") await runPosSlip(upload, buffer);
    else if (upload.type === "store_summary") await runStoreSummary(upload, buffer);
    else if (upload.type === "bank_receipt") await runBankReceipt(upload, buffer);
    else if (upload.type === "expense") await runExpense(upload, buffer);
    else if (upload.type === "z_report") await runZReport(upload, buffer);
    else if (upload.type === "dealer_daily_report") await runDealerDailyReport(upload, buffer, opts);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.error("[OCR] failed", { uploadId, type: upload.type, error: raw });
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "failed", error_message: humanizeOcrError(e).slice(0, 1000) },
    });
  }

  if (screening) {
    const phase1 = await screening.catch(() => null);
    await applyAuthenticity(upload, phase1);
  }
}

/**
 * Domain errors are already Turkish and actionable; everything else
 * (SDK timeouts, 5xx, sharp/heic decode errors, Zod re-validation of the
 * model's output) reached the cashier verbatim — "Request timed out.",
 * a JSON issue array. Map those to one line that says what to do.
 */
function humanizeOcrError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.constructor.name : "";
  if (name === "ZodError" || msg.trimStart().startsWith("[")) {
    return "Belgeden okunan değerler beklenen biçimde değil. Görseli dik, yakından ve net çekip yeniden yükleyin.";
  }
  if (/timed out|ETIMEDOUT|APIConnectionTimeout/i.test(msg)) {
    return "Okuma servisi zamanında yanıt vermedi. \"Yeniden analiz et\" ile tekrar deneyin.";
  }
  if (/overloaded|529|rate limit|429|500|502|503|APIError|Internal server error/i.test(msg) && !/[çğıöşü]/i.test(msg)) {
    return "Okuma servisi geçici olarak yanıt vermiyor. Birkaç dakika sonra \"Yeniden analiz et\" ile tekrar deneyin.";
  }
  if (/credit balance|insufficient|billing/i.test(msg)) {
    return "Okuma servisi bakiyesi bitti — yöneticinize bildirin.";
  }
  if (/unsupported image|Input buffer|heic|heif|VipsJpeg|corrupt|Input file/i.test(msg) && !/[çğıöşü]/i.test(msg)) {
    return "Görsel dosyası açılamadı (bozuk ya da desteklenmeyen biçim). Fotoğrafı yeniden çekip yükleyin.";
  }
  if (/non-JSON|Claude returned/i.test(msg)) {
    return "Belge okunamadı (okuma servisi beklenmeyen yanıt verdi). \"Yeniden analiz et\" ile tekrar deneyin.";
  }
  if (/Unique constraint|P2002/i.test(msg)) {
    return "Bu güne aynı türde bir belge zaten kayıtlı. Önce mevcut kaydı silin.";
  }
  return msg;
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
  await stashRaw(upload.id, raw);

  if (!parsed.is_pos_slip) {
    throw new Error(
      parsed.rejection_reason ??
        "Bu bir POS gün sonu raporu gibi görünmüyor. Lütfen geçerli bir POS gün sonu slipini yükleyin."
    );
  }
  // An interim report ("ARA RAPOR" / "X RAPORU") is a running total with the
  // batch still open — not the day's close. One was accepted and counted on
  // Mavi Lefkoşa 20.09.2026 (30.790,00 TL at 19:30) before this check. The
  // printed title is matched here as well, so the refusal does not hang on
  // the model's classification alone.
  // Only the verbatim title is matched — the model's own notes may well say
  // "ara rapor DEĞİL" about a proper day-end slip.
  // Refused ONLY when the slip itself prints "ARA RAPOR" / "X RAPORU". The
  // model's own classification (report_kind) is kept for information but
  // never refuses on its own: it called two genuine day-end slips interim —
  // İş Bankası "GRUP RAPORU (AYRINTILI)" + "GÜNSONU MUTABAKATI" (22.09.2026)
  // and Yapı Kredi "DETAY İŞLEMLER LİSTESİ" + "GRUP BAŞARILI" (23.09.2026),
  // both from the itemised heading. The one real interim slip on file
  // (Mavi Lefkoşa 20.09.2026) prints "ARA RAPOR" as title and closing line.
  // An admin who has looked at the slip can override (skip_interim_check).
  //
  // Two printed signals decide, the model's opinion only breaks a tie:
  //  - a printed "ARA RAPOR" / "X RAPORU" → interim;
  //  - otherwise the model's "ara_rapor" stands only if NO day-closing line
  //    is printed. Measured 2026-09-24: the model sometimes skips the large
  //    "ARA RAPOR" header of a real interim slip ("TechPOS SLIP BILGI" read
  //    as title), and calls itemised day-end slips interim; a printed
  //    closing line ("GRUP BAŞARILI", "GÜNSONU …", "MUTABAKAT") is what a
  //    day-end has and an interim slip does not.
  const printed = `${parsed.interim_marker ?? ""} ${parsed.title_text ?? ""}`;
  const printedInterim = /\bARA\s*RAPOR|\bX\s*RAPOR/i.test(printed);
  const closing = `${parsed.day_end_marker ?? ""} ${parsed.title_text ?? ""}`;
  const printedDayEnd =
    !/ARA\s*RAPOR/i.test(parsed.day_end_marker ?? "") &&
    /GRUP\s*BA[ŞS]ARILI|GRUP\s*KAPAMA|G[ÜU]N\s*SONU|MUTABAKAT|ALACAK\s*KAYDED|TAMAMLANMI|BATCH\s*KAPAT/i.test(closing);
  const skipInterim = (upload.user_meta_json as { skip_interim_check?: boolean } | null)?.skip_interim_check;
  const interim = printedInterim || (parsed.report_kind === "ara_rapor" && !printedDayEnd);
  if (interim && !skipInterim) {
    throw new Error(
      "Bu bir ARA RAPOR — gün sonu raporu değil. Ara rapor günü kapatmaz, yalnızca o saate kadarki tutarı gösterir. POS cihazından GÜN SONU alın ve o slibi yükleyin."
    );
  }
  parsed.date = await assertDateMatch(
    upload.daily_record_id,
    parsed.date,
    "POS slibi",
    parsed.date_raw
  );

  // Bir slip = bir ya da daha fazla banka kapanışı. Ortak terminal (Koopbank
  // Optimum + Yapı Kredi) tek uzun slip basar; her banka ayrı gün sonu
  // verir ve ayrı PosSlip satırı olur. Model `sections` doldurmadıysa tekil
  // alanlar tek bankalı slip demektir.
  const sections =
    parsed.sections && parsed.sections.length > 0
      ? parsed.sections
      : [
          {
            bank_name: parsed.bank_name ?? "",
            terminal_no: parsed.terminal_no,
            sales_count: parsed.sales_count,
            sales_amount: parsed.sales_amount,
            refund_count: parsed.refund_count,
            refund_amount: parsed.refund_amount,
            net_amount: parsed.net_amount,
          },
        ];

  // Bank name from the store's own history of the same terminal. The bank
  // is often printed only as a logo; Mavi Girne 23.09.2026 (Garanti BBVA,
  // terminal 01088088) came back as "Koopbank", "Bilinmiyor" and "Naturel
  // Ticaret" in three reads, while the same terminal was stored as Garanti
  // BBVA in May. A terminal that has always meant ONE bank in this store is
  // that bank; shared terminals (Optimum: Koopbank + Yapı Kredi on one
  // number) have two and are left to the reading.
  await resolveBankFromTerminalHistory(upload.daily_record_id, sections);

  // Hiçbir bankada tutar yoksa bu bir "0" kaydı olur ve mutabakatı sessizce
  // bozar — kabul etme.
  if (sections.every((sec) => sec.net_amount == null)) {
    throw new Error(
      "POS slibinden tutar okunamadı. Slibi TEK BAŞINA, dik ve yakından çekin " +
        "(karede başka belge olmasın). Uzun slibi (Optimum + Yapı Kredi) parça " +
        "parça yüklüyorsanız her parçada bankanın kendi GENEL TOPLAM / TOPLAM " +
        "satırı görünsün; en sondaki ÖZET RAPORU tek başına yetmez."
    );
  }

  // Bölümler tek tek mükerrer kontrolünden geçer. Yırtık slipte (Koopbank
  // parçası ve Yapı Kredi parçası ayrı yüklenir) bir parçanın kuyruğu öbür
  // bankanın kapanış toplamını da taşıyabilir; o bölüm daha önce
  // kaydedilmişse yalnız o atlanır, parçanın getirdiği yeni banka yine
  // kaydedilir. Bütün bölümler zaten kayıtlıysa bu yükleme yeni bir şey
  // getirmiyordur → tekrar (replay) olarak reddedilir.
  const fmtTry = (n: number | null) =>
    n == null ? "" : `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
  const seenBanks = new Set<string>();
  const skipped: string[] = [];
  let duplicateOf: string | null = null;
  let recorded = 0;
  const scope = await dupScope(upload);
  for (const sec of sections) {
    const bankName = sec.bank_name || null;
    // Aynı slipte aynı banka iki kez çıkarsa (model tekrar etmişse) ilkini tut.
    const bankKey = bankName ?? "";
    if (seenBanks.has(bankKey)) continue;
    seenBanks.add(bankKey);

    // Fingerprint over content-defining fields. If two photos of the
    // same slip get uploaded, they all collapse to the same fingerprint.
    // Computed even when the bank could not be read: terminal + date +
    // amount + count still identify the slip.
    const fingerprint = createHash("sha256")
      .update(
        [
          bankName ?? "",
          sec.terminal_no ?? "",
          parsed.date ?? "",
          String(sec.net_amount ?? ""),
          String(sec.sales_count ?? ""),
        ].join("|")
      )
      .digest("hex");

    // 🛡️ Fraud guard #2: content replay. Same slip captured as a
    // different photo (different file hash) but identical OCR fields —
    // anywhere in this store, not only on this day.
    if (!duplicateCheckSkipped(upload)) {
      const dup = await prisma.posSlip.findFirst({
        where: {
          daily_record: { store_id: scope.store_id },
          content_fingerprint: fingerprint,
          NOT: { upload_id: upload.id },
        },
        select: { upload_id: true },
      });
      if (dup) {
        skipped.push(`${bankName ?? "banka"} ${fmtTry(sec.net_amount)}`.trim());
        duplicateOf = duplicateOf ?? dup.upload_id;
        continue;
      }
    }

    const fields = {
      bank_name: bankName,
      terminal_no: sec.terminal_no,
      slip_date: parsed.date ? new Date(`${parsed.date}T00:00:00.000Z`) : null,
      sales_count: sec.sales_count,
      sales_amount: sec.sales_amount,
      refund_count: sec.refund_count,
      refund_amount: sec.refund_amount,
      net_amount: sec.net_amount,
      currency: parsed.currency,
      net_amount_try: parsed.currency === "TRY" ? sec.net_amount : null,
      content_fingerprint: fingerprint,
    };
    // Prisma bileşik unique'i nullable kolonla (bank_name) `where` içinde
    // kabul etmez; findFirst + create/update ile aynı sonucu alıyoruz.
    const existing = await prisma.posSlip.findFirst({
      where: { upload_id: upload.id, bank_name: bankName },
      select: { id: true },
    });
    if (existing) {
      await prisma.posSlip.update({ where: { id: existing.id }, data: fields });
    } else {
      await prisma.posSlip.create({
        data: { upload_id: upload.id, daily_record_id: upload.daily_record_id, ...fields },
      });
    }
    recorded++;
  }

  if (recorded === 0) {
    if (duplicateOf) {
      await failAsDuplicate(upload, duplicateOf, `Bu POS fişi (${skipped.join(", ")} — aynı banka, terminal, tarih, tutar)`);
    } else {
      await prisma.upload.update({
        where: { id: upload.id },
        data: { status: "failed", error_message: "Bu slipten kaydedilecek bir banka bölümü çıkmadı." },
      });
    }
    return;
  }

  // Atlanan bölümler listede görünsün ("Koopbank 20.668,00 ₺ zaten kayıtlıydı").
  const rawOut = skipped.length
    ? { ...(raw as Record<string, unknown>), skipped_sections: skipped }
    : raw;
  await markParsed(upload.id, rawOut, parsed);
}

async function runStoreSummary(upload: Upload, buffer: Buffer): Promise<void> {
  const { raw, parsed } = await parseStoreSummary({
    buffer,
    mimeType: upload.mime_type,
  });
  await stashRaw(upload.id, raw);
  if (!parsed.is_store_summary) {
    throw new Error(
      parsed.rejection_reason ??
        "Bu bir mağaza özet raporu gibi görünmüyor. Lütfen geçerli bir mağaza gün sonu özet raporu yükleyin."
    );
  }

  // 🛡️ Marka formatı + mağaza ismi eşleşmesi: yanlış mağazaya yüklemeyi engelle.
  const dr = await prisma.dailyRecord.findUnique({
    where: { id: upload.daily_record_id },
    include: {
      store: { include: { brand: true } },
      merge_group: {
        include: {
          daily_records: { orderBy: { date: "asc" }, select: { date: true } },
        },
      },
    },
  });

  // ── Tarih kontrolü: gün birleşmesi mi, tek gün mü? ──
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  if (dr?.merge_group) {
    const g = dr.merge_group;
    const groupStartIso = g.start_date.toISOString().slice(0, 10);
    const groupEndIso = g.end_date.toISOString().slice(0, 10);
    const thisDayIso = dr.date.toISOString().slice(0, 10);

    // Mağaza özeti SADECE grubun SON gününe yüklenir
    if (thisDayIso !== groupEndIso) {
      throw new Error(
        `Bu gün (${fmtDateTr(thisDayIso)}) birleşmenin son günü değil. Mağaza özeti birleşik aralığın SON gününe (${fmtDateTr(groupEndIso)}) yüklenir.`
      );
    }

    // OCR aralık okuduysa grupla karşılaştır (Derimod alt tarih aralığı)
    const pStart = parsed.period_start;
    const pEnd = parsed.period_end;
    if (dr.store.brand.name.toLowerCase().includes("mavi")) {
      // Mavi (IT POS) özeti tek tarih basar — aralık yazmaz. Kasa
      // kapatılamadığında basılan özet, açık kalan günün ya da kapanış
      // gününün tarihini taşıyabilir; ikisi de birleşmenin içindedir.
      const stamps = [parsed.summary_date, pStart, pEnd].filter((d): d is string => !!d);
      const outside = stamps.find((d) => d < groupStartIso || d > groupEndIso);
      if (outside) {
        throw new Error(
          `Özet tarihi (${fmtDateTr(outside)}) birleşme aralığının (${fmtDateTr(groupStartIso)} → ${fmtDateTr(groupEndIso)}) dışında. Bu günleri kapsayan özeti yükleyin.`
        );
      }
    } else if (pStart && pEnd) {
      if (pStart !== groupStartIso || pEnd !== groupEndIso) {
        throw new Error(
          `Özetteki tarih aralığı (${fmtDateTr(pStart)} → ${fmtDateTr(pEnd)}) seçilen birleşme aralığıyla (${fmtDateTr(groupStartIso)} → ${fmtDateTr(groupEndIso)}) uyuşmuyor. Doğru aralığı kapsayan özeti yükleyin.`
        );
      }
    } else if (parsed.summary_date && parsed.summary_date !== groupEndIso) {
      // Aralık okunamadıysa en azından tek tarih son güne denk gelmeli
      throw new Error(
        `Özet tarihi (${fmtDateTr(parsed.summary_date)}) birleşmenin son günüyle (${fmtDateTr(groupEndIso)}) uyuşmuyor.`
      );
    }
    periodStart = g.start_date;
    periodEnd = g.end_date;
  } else {
    // Normal tek gün — eski katı tarih kontrolü. The resolved date (year
    // leniency) is what gets persisted, or a "2025" misread would land in
    // the wrong year and skip the Nebim cross-check.
    parsed.summary_date = await assertDateMatch(
      upload.daily_record_id,
      parsed.summary_date,
      "Mağaza özeti"
    );
    if (parsed.summary_date) {
      periodStart = new Date(`${parsed.summary_date}T00:00:00.000Z`);
      periodEnd = periodStart;
    }
  }
  if (dr) {
    const brandLower = dr.store.brand.name.toLowerCase();
    const isMaviBrand = brandLower.includes("mavi");
    const isDerimodBrand = brandLower.includes("derimod");

    // Marka ↔ format kontrolü
    if (isMaviBrand && parsed.report_format === "nebim") {
      throw new Error(
        `Bu mağaza "${dr.store.brand.name}" markası (IT POS bekleniyor) ama yüklenen rapor Nebim formatında — yanlış marka raporu olabilir.`
      );
    }
    if (isDerimodBrand && parsed.report_format === "it_pos") {
      throw new Error(
        `Bu mağaza "${dr.store.brand.name}" markası (Nebim bekleniyor) ama yüklenen rapor IT POS formatında — yanlış marka raporu olabilir.`
      );
    }

    // Mavi → kod bazlı kontrol (öncelik)
    // 9400 Lefkoşa / 9401 Girne / 9402 Mağusa / 9403 Güzelyurt
    if (isMaviBrand && parsed.store_code_on_report) {
      const code = parsed.store_code_on_report.trim();
      const expectedHint = MAVI_STORE_CODE_MAP[code];
      if (!expectedHint) {
        throw new Error(
          `Raporda Mavi mağaza kodu "${code}" yazıyor ama tanınmıyor (beklenen: 9400/9401/9402/9403).`
        );
      }
      const storeNorm = normalizeName(dr.store.name);
      const hintNorm = normalizeName(expectedHint);
      if (!storeNorm.includes(hintNorm)) {
        throw new Error(
          `Bu rapor Mavi ${expectedHint} (kod ${code}) mağazasına ait — "${dr.store.name}" mağazasına yüklenemez.`
        );
      }
      // Kod eşleşti — isim varyasyonu (Magosa↔Magusa vs.) önemsiz, geç.
    } else if (parsed.store_name_on_report) {
      // Nebim veya kod yoksa fallback: mağaza ismi fuzzy eşleşmesi
      const reportNorm = normalizeName(parsed.store_name_on_report);
      const expectedNorm = normalizeName(dr.store.name);
      // Mağaza adından anlamlı token'ları al (örn "lefkosa", "girne", "guzelyurt")
      const tokens = expectedNorm
        .split(/\s+/)
        .filter((t) => t.length >= 4 && !["mavi", "derimod"].includes(t));
      const matchFound =
        tokens.length === 0 || tokens.some((t) => reportNorm.includes(t));
      if (!matchFound) {
        throw new Error(
          `Raporda "${parsed.store_name_on_report}" yazıyor ama "${dr.store.name}" mağazasına yükleme yapılmaya çalışıldı. Doğru mağazaya yükle.`
        );
      }
    }
  }

  // Same-day SAP dealer report as the arbiter for the Kartuş/Alışveriş Çeki
  // label mix-up (see parseStoreSummary): SAP counts loyalty and gift-card
  // payments separately and to the kuruş.
  if (parsed.report_format === "it_pos" && parsed.currency === "TRY") {
    const sap = await prisma.dealerDailyReport.findUnique({ where: { daily_record_id: upload.daily_record_id } });
    if (sap) {
      const fix = reconcileExtraRowsWithSap(
        { loyalty: parsed.loyalty_points_total, voucher: parsed.shopping_voucher_total, sales: parsed.sales_total, cash: parsed.cash_sales, card: parsed.credit_card_total },
        { loyalty: sap.loyalty_try.toNumber(), gift: sap.gift_card_try?.toNumber() ?? 0 }
      );
      if (fix) {
        parsed.loyalty_points_total = fix.loyalty;
        parsed.shopping_voucher_total = fix.voucher;
        await stashRaw(upload.id, { ...(raw as object), sap_extra_rows_fix: fix.note });
      }
    }
  }

  const tryFor = (v: number | null) => (parsed.currency === "TRY" ? v : null);
  const fields = {
    sales_total: parsed.sales_total,
    cash_sales: parsed.cash_sales,
    credit_card_total: parsed.credit_card_total,
    loyalty_points_total: parsed.loyalty_points_total,
    shopping_voucher_total: parsed.shopping_voucher_total,
    wire_transfer_total: parsed.wire_transfer_total,
    opening_balance: parsed.opening_balance,
    closing_balance: parsed.closing_balance,
    currency: parsed.currency,
    sales_total_try: tryFor(parsed.sales_total),
    cash_sales_try: tryFor(parsed.cash_sales),
    credit_card_total_try: tryFor(parsed.credit_card_total),
    loyalty_points_total_try: tryFor(parsed.loyalty_points_total),
    shopping_voucher_total_try: tryFor(parsed.shopping_voucher_total),
    wire_transfer_total_try: tryFor(parsed.wire_transfer_total),
    period_start: periodStart,
    period_end: periodEnd,
  };
  // ── Akıl kontrolü: bileşenler toplam satışı aşamaz ──────────────────
  // Kartuş puan / nakit / kart hepsi satışın İÇİNDEDİR. OCR bir rakamı
  // yanlış sütundan okuduğunda (bir kez ₺23,9 milyon kartuş puanı okundu,
  // gün cirosu ₺108 bindi) bu sessizce kaydedilip Kar/Zarar tablosunu
  // anlamsız hale getiriyordu. Böyle bir değeri kabul etmek yerine reddet:
  // kullanıcı belgeyi yeniden yükler ya da elle düzeltir.
  const salesTotal = parsed.sales_total;
  if (salesTotal != null && salesTotal > 0) {
    const overs: string[] = [];
    const check = (label: string, v: number | null | undefined) => {
      // Küçük yuvarlama farkları için %1 pay bırak.
      if (v != null && v > salesTotal * 1.01) {
        overs.push(`${label} ${fmtMoneyTr(v)} ₺`);
      }
    };
    check("Kartuş Puan", parsed.loyalty_points_total);
    check("Nakit", parsed.cash_sales);
    check("Kredi Kartı", parsed.credit_card_total);
    check("Alışveriş Çeki", parsed.shopping_voucher_total);
    if (overs.length > 0) {
      throw new Error(
        `Mağaza Özeti okunamadı: ${overs.join(", ")} toplam satıştan ` +
          `(${fmtMoneyTr(salesTotal)} ₺) büyük — bu mümkün değil, bir rakam ` +
          `yanlış okunmuş. Görseli daha net çekip tekrar yükleyin.`
      );
    }

    // Bileşenler toplamı satışı vermeli. Tutmuyorsa OCR bir satır kaymış
    // demektir (bir kez nakit/kart/kartuş bir satır aşağı okundu).
    // Kuruş yuvarlaması ve küçük OCR sapmaları için pay bırak.
    const tolerance = Math.max(1, salesTotal * 0.01);
    if (parsed.report_format === "nebim") {
      // Nebim'de Kartuş Puan ve Alışveriş Çeki YOKTUR (hep null) — eski
      // "hepsi doluysa kontrol et" kuralı bu yüzden Derimod'da hiç
      // çalışmıyordu ve Nakit=0 / Normal-satırı-toplam gibi okumalar sessizce
      // kaydediliyordu (25.08.2026 S02'de 3 denemede 3 farklı sonuç ölçüldü).
      // Denklem: Nakit + Kredi Kartı + Kredi Çeki neti = Toplam satırı Net.
      const sum =
        (parsed.cash_sales ?? 0) +
        (parsed.credit_card_total ?? 0) +
        (parsed.credit_voucher_total ?? 0);
      if (Math.abs(sum - salesTotal) > tolerance) {
        throw new Error(
          `Mağaza Özeti okunamadı: Ödemeler tablosundan Nakit + Kredi Kartı ` +
            `(+ Kredi Çeki) = ${fmtMoneyTr(sum)} ₺ okundu, ama Satış tablosunda ` +
            `Toplam satırının Net Tutar'ı ${fmtMoneyTr(salesTotal)} ₺. ` +
            `Rakamlar birbirini tutmuyor — bir satır yanlış okunmuş olabilir ` +
            `(Kasa bakiyeleri satış değildir). Görseli daha net çekip tekrar ` +
            `yükleyin.`
        );
      }
    } else {
      // IT POS: yalnız hepsi okunabildiyse kontrol et — eksik alan varsa
      // denklem kurulamaz.
      const parts = [
        parsed.cash_sales,
        parsed.credit_card_total,
        parsed.loyalty_points_total,
        parsed.shopping_voucher_total,
      ];
      if (parts.every((v) => v != null)) {
        // Havale (IBAN) is optional on the report but part of the sum.
        const sum =
          parts.reduce<number>((a, v) => a + (v ?? 0), 0) + (parsed.wire_transfer_total ?? 0);
        if (Math.abs(sum - salesTotal) > tolerance) {
          throw new Error(
            `Mağaza Özeti okunamadı: Nakit + Kredi Kartı + Kartuş + Alışveriş ` +
              `Çeki + Havale = ${fmtMoneyTr(sum)} ₺, ama Satış Toplam ` +
              `${fmtMoneyTr(salesTotal)} ₺. Rakamlar birbirini tutmuyor — ` +
              `muhtemelen bir satır yanlış okundu. Görseli daha net çekip ` +
              `tekrar yükleyin.`
          );
        }
      }
    }

    // Derimod: aynı Nebim tablolarından gelen köprü satırlarıyla çapraz kontrol.
    // Admin "farkı bilerek kabul et" dediyse (user_meta.skip_nebim_check) atlanır:
    // köprü iptal edilmiş belgeleri de taşıyor (31.08 Lefkoşa: 09:58'de iptal
    // edilen 1.499,99'luk iade), basılı rapor ise onları saymıyor.
    const meta = upload.user_meta_json as { skip_nebim_check?: boolean } | null;
    if (
      dr &&
      dr.store.brand.name.toLowerCase().includes("derimod") &&
      periodStart &&
      periodEnd &&
      !meta?.skip_nebim_check
    ) {
      await assertNebimNetMatch(dr.store_id, periodStart, periodEnd, salesTotal);
    }
  }

  // One summary per period per store: the same report pushed to another
  // day (or a merged range) is a replay.
  if (periodStart && periodEnd && !duplicateCheckSkipped(upload)) {
    const scope = await dupScope(upload);
    const dup = await prisma.storeSummary.findFirst({
      where: {
        daily_record: { store_id: scope.store_id },
        period_start: periodStart,
        period_end: periodEnd,
        NOT: { upload_id: upload.id },
      },
      select: { upload_id: true },
    });
    if (dup) {
      await failAsDuplicate(upload, dup.upload_id, `Bu Mağaza Özeti (${fmtDateTr(periodStart.toISOString().slice(0, 10))}${periodEnd.getTime() !== periodStart.getTime() ? `–${fmtDateTr(periodEnd.toISOString().slice(0, 10))}` : ""})`);
      return;
    }
  }

  await prisma.storeSummary.upsert({
    where: { upload_id: upload.id },
    update: fields,
    create: { upload_id: upload.id, daily_record_id: upload.daily_record_id, ...fields },
  });
  await markParsed(upload.id, raw, parsed);
}

/**
 * Derimod cross-check: the printed "Mağaza Hareket Özeti" and the bridge's
 * NebimSaleLine rows are the same Nebim data, so the period's net matches to
 * the kuruş (verified on S02 07.08, 24.08, 25.08 and 01.09.2026). The one
 * misread this catches that the payments equation cannot: taking the
 * "Normal" row (returns not yet deducted) as the total — payments also sum
 * to that figure, so the equation still balances.
 *
 * Enforced only when the bridge re-pulled the day AFTER it closed (a row
 * updated on or after the next day; the scheduled 10:00 run always is). An
 * intra-day pull is partial and must not block the upload; no rows at all
 * means the bridge has not reached that day yet.
 */
async function assertNebimNetMatch(
  storeId: string,
  periodStart: Date,
  periodEnd: Date,
  ocrSales: number
): Promise<void> {
  const lines = await prisma.nebimSaleLine.findMany({
    where: { store_id: storeId, invoice_date: { gte: periodStart, lte: periodEnd } },
    select: {
      net_amount: true,
      is_return: true,
      updated_at: true,
      invoice_ref: true,
      customer_name: true,
      created_date: true,
    },
  });
  if (lines.length === 0) return;
  // A return whose credit voucher Nebim has since deleted was cancelled in
  // Nebim (voucher-snapshot.ts); the printed report does not count it, the
  // bridge still carries its lines. Leave those invoices out of the net.
  const missing = await missingVoucherSerials(prisma);
  const cancelled = new Set<string>();
  if (missing.serials.length > 0) {
    const txns = await prisma.nebimVoucherTxn.findMany({
      where: { serial: { in: missing.serials }, invoice_ref: { not: null } },
      select: { invoice_ref: true },
    });
    for (const t of txns) if (t.invoice_ref) cancelled.add(t.invoice_ref);
  }
  let total = 0;
  let normalOnly = 0;
  let lastPull = 0;
  const byInvoice = new Map<string, { net: number; ret: boolean; who: string | null; at: Date | null }>();
  for (const l of lines) {
    if (cancelled.has(l.invoice_ref)) continue;
    const n = l.net_amount ? l.net_amount.toNumber() : 0;
    total += n;
    if (!l.is_return) normalOnly += n;
    lastPull = Math.max(lastPull, l.updated_at.getTime());
    const inv = byInvoice.get(l.invoice_ref) ?? { net: 0, ret: l.is_return, who: l.customer_name, at: l.created_date };
    inv.net += n;
    byInvoice.set(l.invoice_ref, inv);
  }
  const dayAfterPeriod = periodEnd.getTime() + 24 * 60 * 60 * 1000;
  if (lastPull < dayAfterPeriod) return;

  const tolerance = Math.max(2, Math.abs(total) * 0.005);
  if (Math.abs(total - ocrSales) <= tolerance) return;
  const readNormalRow =
    Math.abs(normalOnly - ocrSales) <= tolerance &&
    Math.abs(normalOnly - total) > tolerance;
  let hint = readNormalRow
    ? ` Okunan rakam iadesiz "Normal" satırının neti; Satış tablosunda ` +
      `"Toplam" satırının Net Tutar'ı alınmalı.`
    : "";
  // Which Nebim document(s) explain the gap? A single invoice whose net
  // equals the difference is almost always the story: the bridge carries
  // documents Nebim later cancelled (31.08 Lefkoşa, a return voided at
  // 09:58) and the printed report does not count them. Name it so the
  // admin can decide, instead of re-shooting a correct photo.
  if (!readNormalRow) {
    const gap = total - ocrSales; // Nebim − rapor
    const match = Array.from(byInvoice.entries()).find(([, v]) => Math.abs(v.net - gap) <= 0.05);
    if (match) {
      const [ref, v] = match;
      const when = v.at ? ` ${v.at.toISOString().slice(11, 16)}` : "";
      hint =
        ` Fark ${fmtMoneyTr(Math.abs(gap))} ₺ = Nebim'deki ${ref} ` +
        `(${v.ret ? "iade" : "satış"}${v.who ? `, ${v.who}` : ""}${when}); bu belge basılı ` +
        `raporda yok — Nebim'de iptal edilmiş olabilir. Rapor doğruysa admin "farkı bilerek ` +
        `kabul et" ile kaydedebilir.`;
    }
  }
  throw new Error(
    `Mağaza Özeti okunamadı: Satış Toplam ${fmtMoneyTr(ocrSales)} ₺ okundu, ` +
      `ama Nebim'e göre bu dönemin neti ${fmtMoneyTr(total)} ₺.${hint}` +
      (hint ? "" : " Görseli daha net çekip tekrar yükleyin.")
  );
}

async function runBankReceipt(upload: Upload, buffer: Buffer): Promise<void> {
  const { raw, parsed } = await parseBankReceipt({
    buffer,
    mimeType: upload.mime_type,
  });
  await stashRaw(upload.id, raw);
  if (!parsed.is_bank_receipt) {
    throw new Error(
      parsed.rejection_reason ??
        "Bu bir İban dekontu gibi görünmüyor. Lütfen IBAN'lı bir banka transferi/havale dekontu yükleyin."
    );
  }
  parsed.deposit_date = await assertDateMatch(upload.daily_record_id, parsed.deposit_date, "İban dekontu");
  if (parsed.amount === null) {
    throw new Error(
      "İban dekontundan tutar okunamadı — manuel düzenleme gerekli"
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
  // Same transfer (IBAN/bank + date + amount) already on file in this store.
  if (!duplicateCheckSkipped(upload)) {
    const scope = await dupScope(upload);
    const candidates = await prisma.bankReceipt.findMany({
      where: {
        daily_record: { store_id: scope.store_id },
        deposit_date: fields.deposit_date,
        amount_try,
        NOT: { upload_id: upload.id },
      },
      select: { upload_id: true, iban: true, bank_name: true },
    });
    // The IBAN is not a tie-breaker: two readings of one receipt differed in
    // its digits (…0008160700246 42 vs …0000168070024642, Mavi Girne 28.09).
    // Same bank family + date + amount is the receipt; a second transfer of
    // the same amount from the same bank on one day goes through the admin.
    const dup = candidates.find(
      (c) => !c.bank_name || !parsed.bank_name || bankKey(c.bank_name) === bankKey(parsed.bank_name)
    );
    if (dup?.upload_id) {
      await failAsDuplicate(upload, dup.upload_id, `Bu İban dekontu (${fmtDateTr(parsed.deposit_date)}, ${amount_try} ₺)`);
      return;
    }
  }
  await prisma.bankReceipt.upsert({
    where: { upload_id: upload.id },
    update: fields,
    create: { upload_id: upload.id, daily_record_id: upload.daily_record_id, ...fields },
  });
  await markParsed(upload.id, raw, parsed);
}

async function runExpense(upload: Upload, buffer: Buffer): Promise<void> {
  const { raw, parsed } = await parseExpense({ buffer, mimeType: upload.mime_type });
  await stashRaw(upload.id, raw);
  if (!parsed.is_expense) {
    throw new Error(
      parsed.rejection_reason ??
        "Bu bir fatura/makbuz gibi görünmüyor. Lütfen geçerli bir fatura veya makbuz yükleyin."
    );
  }
  parsed.expense_date = await assertDateMatch(
    upload.daily_record_id,
    parsed.expense_date,
    "Fatura",
    parsed.expense_date_raw
  );
  if (parsed.amount === null) {
    throw new Error(
      "Faturadan tutar okunamadı — manuel düzenleme gerekli"
    );
  }

  // Kullanıcı yükleme öncesi kategori/açıklama girdiyse OCR sonucunu override et
  const userMeta = upload.user_meta_json as
    | { expense_category?: string; expense_description?: string }
    | null;
  const finalCategory =
    (userMeta?.expense_category as typeof parsed.category) || parsed.category;
  const finalDescription =
    userMeta?.expense_description || parsed.description;

  const amount_try = parsed.currency === "TRY" ? parsed.amount : parsed.amount; // FX Phase 5
  const fields = {
    category: finalCategory,
    vendor: parsed.vendor,
    amount: parsed.amount,
    currency: parsed.currency,
    amount_try,
    expense_date: new Date(`${parsed.expense_date}T00:00:00.000Z`),
    description: finalDescription,
    vat_rate: parsed.vat_rate,
    vat_included: parsed.vat_included,
    // Kullanıcı girdiği bilgi varsa user_corrected işaretle
    user_corrected: !!(userMeta?.expense_category || userMeta?.expense_description),
  };
  // Same receipt (vendor + date + amount) already on file in this store —
  // a second photo of the same fatura must not count twice.
  if (!duplicateCheckSkipped(upload)) {
    const scope = await dupScope(upload);
    const candidates = await prisma.expense.findMany({
      where: {
        daily_record: { store_id: scope.store_id },
        expense_date: fields.expense_date,
        amount_try,
        NOT: { upload_id: upload.id },
      },
      select: { upload_id: true, vendor: true },
    });
    const dup = candidates.find((c) => sameIdentity(c.vendor, parsed.vendor));
    if (dup?.upload_id) {
      await failAsDuplicate(upload, dup.upload_id, `Bu fatura/makbuz (${parsed.vendor ?? "satıcı okunamadı"}, ${fmtDateTr(parsed.expense_date)}, ${amount_try} ₺)`);
      return;
    }
  }
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
  await stashRaw(upload.id, raw);

  if (!parsed.is_z_report) {
    throw new Error(
      parsed.rejection_reason ??
        "Bu bir yazar kasa Z raporu gibi görünmüyor. Lütfen geçerli bir Z raporu yükleyin."
    );
  }

  // 🛡️ Belt-and-suspenders: OCR yanılgısına karşı ham metinde X RAPORU
  // ipuçlarını tekrar tara. Z raporları "Z RAPORU" başlığı taşır;
  // gün içi anlık özet olan X raporlarını kabul etmemeliyiz.
  // `check_notes` dışarıda: modelin "X raporu değil" demesi sinyal sayılmasın.
  const { check_notes: _notes, ...rawFields } = (raw ?? {}) as Record<string, unknown>;
  void _notes;
  const rawText = JSON.stringify(rawFields).toUpperCase();
  const hasXSignal = /\bX\s*RAPORU\b|\bX\s*RAPOR\b|\bX\s*NO\b/.test(rawText);
  const hasZSignal = /\bZ\s*RAPORU\b|\bZ\s*RAPOR\b|\bZ\s*NO\b/.test(rawText);
  if (hasXSignal && !hasZSignal) {
    throw new Error(
      "Bu bir X RAPORU (gün içi anlık özet). Z raporu gün sonunda çekilen ve 'Z RAPORU' başlığı taşıyan rapordur — lütfen Z raporu yükleyin."
    );
  }

  parsed.report_date = await assertDateMatch(
    upload.daily_record_id,
    parsed.report_date,
    "Z raporu",
    parsed.report_date_raw
  );

  // Content fingerprint: Z numarası + tarih + brüt + net (cash/KK artık alınmıyor)
  // Without a readable Z number the date + gross + net still identify it.
  const fingerprint = createHash("sha256")
    .update(
      [
        parsed.report_no ?? "",
        parsed.report_date ?? "",
        String(parsed.gross_sales ?? ""),
        String(parsed.net_sales ?? ""),
      ].join("|")
    )
    .digest("hex");

  // Fraud guard #2: same Z replay (different photo, same content), store-wide.
  if (!duplicateCheckSkipped(upload)) {
    const scope = await dupScope(upload);
    const dup = await prisma.zReport.findFirst({
      where: {
        daily_record: { store_id: scope.store_id },
        content_fingerprint: fingerprint,
        NOT: { upload_id: upload.id },
      },
      select: { upload_id: true },
    });
    if (dup) {
      await failAsDuplicate(upload, dup.upload_id, `Bu Z raporu (${parsed.report_no ? `Z-${parsed.report_no}, ` : ""}${fmtDateTr(parsed.report_date)}, net ${parsed.net_sales ?? "?"})`);
      return;
    }
  }

  // Net sales: yoksa gross
  const net = parsed.net_sales ?? parsed.gross_sales;
  const tryFor = (v: number | null) => (parsed.currency === "TRY" ? v : null);

  // KK ve nakit Z raporundan artık OKUNMUYOR — onlar POS fişleri ve
  // Mağaza Özeti kaynaklarından geliyor. DB kolonları nullable, null kalır.
  const fields = {
    report_no: parsed.report_no,
    report_date: parsed.report_date
      ? new Date(`${parsed.report_date}T00:00:00.000Z`)
      : null,
    gross_sales: parsed.gross_sales,
    net_sales: net,
    cash_sales: null,
    credit_card_sales: null,
    refund_amount: parsed.refund_amount,
    vat_total: parsed.vat_total,
    currency: parsed.currency,
    gross_sales_try: tryFor(parsed.gross_sales),
    net_sales_try: tryFor(net),
    cash_sales_try: null,
    credit_card_sales_try: null,
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

  await markParsed(upload.id, raw, parsed);
}

/**
 * MERGED DAYS (Mavi "Kasa Birleşmesi" — the register could not be closed, the
 * days close together under ONE store summary on the last day).
 *
 * The dealer report on the LAST day of the group is the SAP total of the whole
 * group, because that is what the summary is compared with (reconciliation,
 * lock gate, verification page, dashboard — all read the summary day's report).
 * Stores export this file one day at a time (all 29 uploads up to 03.10.2026
 * are single-day exports), but a range export works too, so the total is
 * composed from whatever is on file:
 *
 *   last day's report = rows of THIS file for the last day
 *                     + rows of THIS file for earlier group days that have no
 *                       dealer file of their own
 *                     + the stored report of every earlier group day that has
 *                       its own file (each day counted exactly once)
 *
 * An earlier day's own file is read as that day alone, as always. Whenever
 * one appears or disappears, the last day's file is read again (here, and in
 * upload.delete / mergeGroup create+delete).
 */
async function runDealerDailyReport(upload: Upload, buffer: Buffer, opts: { skipForward?: boolean } = {}): Promise<void> {
  // Excel parser — OCR yok
  const report = parseMaviSapBuffer(buffer);

  // DailyRecord + mağaza bilgisi
  const dr = await prisma.dailyRecord.findUnique({
    where: { id: upload.daily_record_id },
    include: {
      store: { include: { brand: true } },
      merge_group: {
        select: {
          start_date: true,
          end_date: true,
          daily_records: { orderBy: { date: "asc" }, select: { id: true, date: true, dealer_daily_report: true } },
        },
      },
    },
  });
  if (!dr) {
    throw new Error("DailyRecord bulunamadı");
  }

  // 1) Marka kontrolü — sadece Mavi (Derimod NEBIM kullanır, SAP raporu yok).
  // UI'da kart zaten Derimod'da gizli; bu backend kapısı güvenlik ağı.
  const brandLower = dr.store.brand.name.toLocaleLowerCase("tr");
  const isMavi = brandLower.includes("mavi");
  if (!isMavi) {
    throw new Error(
      `Bu özellik şu an sadece Mavi mağazaları için aktif. "${dr.store.brand.name}" markası destek listesinde değil.`
    );
  }

  // 2) Mağaza kodu (9400/01/02/03) seçili mağazaya uymalı
  if (!report.store_code) {
    throw new Error("SAP dosyasında mağaza kodu bulunamadı");
  }
  const expectedHint = report.store_name_hint; // örn "Mağusa"
  if (!expectedHint) {
    throw new Error(
      `Mağaza kodu (${report.store_code}) tanınmıyor. Beklenen kodlar: ${Object.entries(
        MAVI_STORE_CODE_MAP
      )
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}.`
    );
  }
  const storeNorm = normalizeName(dr.store.name);
  const hintNorm = normalizeName(expectedHint);
  if (!storeNorm.includes(hintNorm)) {
    throw new Error(
      `Bu dosya Mavi ${expectedHint} (kod ${report.store_code}) mağazasına ait — "${dr.store.name}" mağazasına yüklenemez.`
    );
  }

  // 3) Seçili güne ait satırlar (dosyada o gün olmalı)
  const dayIso = dr.date.toISOString().slice(0, 10);
  const ownDay = pickDay(report, dr.date);
  if (!ownDay) {
    const dateRange =
      report.source_date_min && report.source_date_max
        ? `${fmtDateTr(report.source_date_min.toISOString().slice(0, 10))} → ${fmtDateTr(
            report.source_date_max.toISOString().slice(0, 10)
          )}`
        : "(boş)";
    throw new Error(`Dosyada ${fmtDateTr(dayIso)} gününe ait satır yok. Dosya tarihleri: ${dateRange}.`);
  }

  // Birleşik günlerin SON günü: grubun tamamının SAP toplamı (yukarıdaki not).
  const group = dr.merge_group;
  const isGroupLast = !!group && dayIso === group.end_date.toISOString().slice(0, 10);
  let day = ownDay;
  let mergeNote: { file_days: string[]; from_own_reports: string[] } | null = null;
  if (group && isGroupLast) {
    const dn = (v: { toNumber: () => number } | null | undefined) => (v ? v.toNumber() : 0);
    const merged = mergedDealerDay(
      report,
      dr.date,
      group.daily_records
        .filter((r) => r.id !== dr.id)
        .map((r) => {
          const o = r.dealer_daily_report;
          return {
            iso: r.date.toISOString().slice(0, 10),
            own: o
              ? {
                  net_sales: dn(o.net_sales_try),
                  loyalty: dn(o.loyalty_try),
                  gift_card: dn(o.gift_card_try),
                  cash: dn(o.cash_try),
                  card: dn(o.card_try),
                  wire: dn(o.wire_try),
                  other: dn(o.other_try),
                  refund_total: dn(o.refund_total_try),
                  transaction_count: o.transaction_count,
                  line_count: o.line_count,
                  refund_count: o.refund_count ?? 0,
                }
              : null,
          };
        })
    );
    if (merged) {
      day = merged.day;
      mergeNote = { file_days: merged.file_days, from_own_reports: merged.from_own_reports };
    }
  }

  // 4) Fingerprint — replay guard
  const fingerprint = dealerReportFingerprint(
    report.store_code,
    day.date,
    day.net_sales,
    day.transaction_count
  );
  const dup = duplicateCheckSkipped(upload)
    ? null
    : await prisma.dealerDailyReport.findFirst({
        where: {
          daily_record: { store_id: (await dupScope(upload)).store_id },
          content_fingerprint: fingerprint,
          NOT: { upload_id: upload.id },
        },
        select: { upload_id: true },
      });
  if (dup) {
    await failAsDuplicate(upload, dup.upload_id, "Bu bayi gün sonu dosyası (aynı mağaza, tarih, net satış, fiş sayısı)");
    return;
  }

  // 5) DealerDailyReport kaydet (upsert — aynı upload için tekrar parse olursa)
  const fields = {
    source: report.source,
    store_code: report.store_code,
    report_date: day.date,
    net_sales_try: day.net_sales,
    loyalty_try: day.loyalty,
    gift_card_try: day.gift_card,
    cash_try: day.cash,
    card_try: day.card,
    wire_try: day.wire,
    other_try: day.other,
    refund_total_try: day.refund_total,
    transaction_count: day.transaction_count,
    line_count: day.line_count,
    refund_count: day.refund_count,
    source_date_min: report.source_date_min,
    source_date_max: report.source_date_max,
    content_fingerprint: fingerprint,
  };
  await prisma.dealerDailyReport.upsert({
    where: { upload_id: upload.id },
    update: fields,
    create: {
      upload_id: upload.id,
      daily_record_id: upload.daily_record_id,
      ...fields,
    },
  });

  await markParsed(upload.id, { totals: report.totals, ...(mergeNote ? { merged_days: mergeNote } : {}) }, day);

  // An earlier day of a merged group got its own file: the last day's report
  // (the group total) has to be composed again.
  if (group && !isGroupLast) {
    const last = group.daily_records[group.daily_records.length - 1];
    const lastUpload = last
      ? await prisma.upload.findFirst({
          where: { daily_record_id: last.id, type: "dealer_daily_report", status: { in: ["parsed", "confirmed"] } },
          select: { id: true },
        })
      : null;
    if (lastUpload) await processUpload(lastUpload.id, { skipForward: true });
  }

  // Per-salesperson revenue of the day — the independent check behind the
  // month-end premium documents (see dealer-report/daily-reps.ts). The other
  // days the same export carries fill gaps. Never fails the upload.
  try {
    await saveReportReps(prisma, {
      storeId: dr.store_id,
      report,
      sapOriginal: isSapOriginal(await xlsxOrigin(buffer)),
      primary: { date: dr.date, dailyRecordId: dr.id },
    });
  } catch (e) {
    console.error("[OCR] dealer report: per-salesperson rows could not be saved", e);
  }

  // The summary may already be on file with the two look-alike rows swapped.
  const existing = await prisma.storeSummary.findUnique({ where: { daily_record_id: upload.daily_record_id } });
  if (existing && existing.currency === "TRY") {
    const fix = reconcileExtraRowsWithSap(
      {
        loyalty: existing.loyalty_points_total_try?.toNumber() ?? null,
        voucher: existing.shopping_voucher_total_try?.toNumber() ?? null,
        sales: existing.sales_total_try?.toNumber() ?? null,
        cash: existing.cash_sales_try?.toNumber() ?? null,
        card: existing.credit_card_total_try?.toNumber() ?? null,
      },
      { loyalty: day.loyalty, gift: day.gift_card }
    );
    if (fix) {
      await prisma.storeSummary.update({
        where: { id: existing.id },
        data: {
          loyalty_points_total: fix.loyalty,
          loyalty_points_total_try: fix.loyalty,
          shopping_voucher_total: fix.voucher,
          shopping_voucher_total_try: fix.voucher,
        },
      });
      console.info("[OCR] store summary extra rows corrected from SAP:", fix.note);
    }
  }

  // The same export feeds the discount-control system; hand it over now that
  // it is known to be this store's own, readable file. Its outcome is kept on
  // the dealer report and never affects this upload. (Not on a mere re-read.)
  if (!opts.skipForward) await forwardDealerReport(upload.id, buffer);
}

/**
 * Persist the model's output BEFORE any validation, so a rejected upload
 * (date mismatch, equation, wrong store) still shows what was read. Without
 * this the 31.08.2026 Mağusa POS slip had to be re-run locally to learn the
 * model had copied the prompt's worked example instead of reading the photo.
 */
async function stashRaw(uploadId: string, raw: unknown): Promise<void> {
  await prisma.upload.update({
    where: { id: uploadId },
    data: { raw_ocr_json: raw as Prisma.InputJsonValue },
  });
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
