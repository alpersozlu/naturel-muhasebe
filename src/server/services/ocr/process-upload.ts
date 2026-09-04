import "server-only";
import { resolveDocumentDate } from "./resolve-doc-date";
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
import {
  parseMaviSapBuffer,
  pickDay,
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

  try {
    const buffer = await downloadUpload(upload);
    if (!buffer) {
      // Eskiden sessizce dönüyordu → kayıt sonsuza kadar "processing" kalıyordu.
      throw new Error("Dosya depodan indirilemedi. Lütfen tekrar yükleyin.");
    }
    if (upload.type === "pos_slip") await runPosSlip(upload, buffer);
    else if (upload.type === "store_summary") await runStoreSummary(upload, buffer);
    else if (upload.type === "bank_receipt") await runBankReceipt(upload, buffer);
    else if (upload.type === "expense") await runExpense(upload, buffer);
    else if (upload.type === "z_report") await runZReport(upload, buffer);
    else if (upload.type === "dealer_daily_report") await runDealerDailyReport(upload, buffer);
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
  await stashRaw(upload.id, raw);

  if (!parsed.is_pos_slip) {
    throw new Error(
      parsed.rejection_reason ??
        "Bu bir POS gün sonu raporu gibi görünmüyor. Lütfen geçerli bir POS gün sonu slipini yükleyin."
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

  // Hiçbir bankada tutar yoksa bu bir "0" kaydı olur ve mutabakatı sessizce
  // bozar — kabul etme.
  if (sections.every((sec) => sec.net_amount == null)) {
    throw new Error(
      "POS slibinden tutar okunamadı. Slibi TEK BAŞINA, dik ve yakından çekin " +
        "(karede başka belge olmasın); birden fazla banka içeriyorsa " +
        "(Optimum + Yapı Kredi) en alttaki ÖZET RAPORU bölümü de görünsün."
    );
  }

  const seenBanks = new Set<string>();
  for (const sec of sections) {
    const bankName = sec.bank_name || null;
    // Aynı slipte aynı banka iki kez çıkarsa (model tekrar etmişse) ilkini tut.
    const bankKey = bankName ?? "";
    if (seenBanks.has(bankKey)) continue;
    seenBanks.add(bankKey);

    // Fingerprint over content-defining fields. If two photos of the
    // same slip get uploaded, they all collapse to the same fingerprint.
    const fingerprint = bankName
      ? createHash("sha256")
          .update(
            [
              bankName,
              sec.terminal_no ?? "",
              parsed.date ?? "",
              String(sec.net_amount ?? ""),
              String(sec.sales_count ?? ""),
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
              `Bu slip'in ${bankName} bölümü bu güne zaten kayıtlı — aynı banka, terminal, tutar. Önce mevcut kaydı silin.`,
          },
        });
        return;
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
  }

  await markParsed(upload.id, raw, parsed);
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
    if (pStart && pEnd) {
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
    // Normal tek gün — eski katı tarih kontrolü
    await assertDateMatch(
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
        const sum = parts.reduce<number>((a, v) => a + (v ?? 0), 0);
        if (Math.abs(sum - salesTotal) > tolerance) {
          throw new Error(
            `Mağaza Özeti okunamadı: Nakit + Kredi Kartı + Kartuş + Alışveriş ` +
              `Çeki = ${fmtMoneyTr(sum)} ₺, ama Satış Toplam ` +
              `${fmtMoneyTr(salesTotal)} ₺. Rakamlar birbirini tutmuyor — ` +
              `muhtemelen bir satır yanlış okundu. Görseli daha net çekip ` +
              `tekrar yükleyin.`
          );
        }
      }
    }

    // Derimod: aynı Nebim tablolarından gelen köprü satırlarıyla çapraz kontrol.
    if (dr && dr.store.brand.name.toLowerCase().includes("derimod") && periodStart && periodEnd) {
      await assertNebimNetMatch(dr.store_id, periodStart, periodEnd, salesTotal);
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
    select: { net_amount: true, is_return: true, updated_at: true },
  });
  if (lines.length === 0) return;
  let total = 0;
  let normalOnly = 0;
  let lastPull = 0;
  for (const l of lines) {
    const n = l.net_amount ? l.net_amount.toNumber() : 0;
    total += n;
    if (!l.is_return) normalOnly += n;
    lastPull = Math.max(lastPull, l.updated_at.getTime());
  }
  const dayAfterPeriod = periodEnd.getTime() + 24 * 60 * 60 * 1000;
  if (lastPull < dayAfterPeriod) return;

  const tolerance = Math.max(2, Math.abs(total) * 0.005);
  if (Math.abs(total - ocrSales) <= tolerance) return;
  const readNormalRow =
    Math.abs(normalOnly - ocrSales) <= tolerance &&
    Math.abs(normalOnly - total) > tolerance;
  const hint = readNormalRow
    ? ` Okunan rakam iadesiz "Normal" satırının neti; Satış tablosunda ` +
      `"Toplam" satırının Net Tutar'ı alınmalı.`
    : "";
  throw new Error(
    `Mağaza Özeti okunamadı: Satış Toplam ${fmtMoneyTr(ocrSales)} ₺ okundu, ` +
      `ama Nebim'e göre bu dönemin neti ${fmtMoneyTr(total)} ₺.${hint} ` +
      `Görseli daha net çekip tekrar yükleyin.`
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
  await assertDateMatch(upload.daily_record_id, parsed.deposit_date, "İban dekontu");
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
  const fingerprint = parsed.report_no
    ? createHash("sha256")
        .update(
          [
            parsed.report_no ?? "",
            parsed.report_date ?? "",
            String(parsed.gross_sales ?? ""),
            String(parsed.net_sales ?? ""),
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

async function runDealerDailyReport(upload: Upload, buffer: Buffer): Promise<void> {
  // Excel parser — OCR yok
  const report = parseMaviSapBuffer(buffer);

  // DailyRecord + mağaza bilgisi
  const dr = await prisma.dailyRecord.findUnique({
    where: { id: upload.daily_record_id },
    include: { store: { include: { brand: true } } },
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

  // 3) Seçili güne ait satırlar filtrele (1-gün modu)
  const day = pickDay(report, dr.date);
  if (!day) {
    const dateRange =
      report.source_date_min && report.source_date_max
        ? `${fmtDateTr(report.source_date_min.toISOString().slice(0, 10))} → ${fmtDateTr(
            report.source_date_max.toISOString().slice(0, 10)
          )}`
        : "(boş)";
    throw new Error(
      `Dosyada ${fmtDateTr(
        dr.date.toISOString().slice(0, 10)
      )} gününe ait satır yok. Dosya tarihleri: ${dateRange}.`
    );
  }

  // 4) Fingerprint — replay guard
  const fingerprint = dealerReportFingerprint(
    report.store_code,
    day.date,
    day.net_sales,
    day.transaction_count
  );
  const dup = await prisma.dealerDailyReport.findFirst({
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
          "Bu bayi raporunun içeriği bu güne zaten kayıtlı (aynı mağaza, tarih, net satış, fiş sayısı). Önce mevcut kaydı silin.",
      },
    });
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

  await markParsed(upload.id, { totals: report.totals }, day);
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
