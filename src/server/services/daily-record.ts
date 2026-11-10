import "server-only";
import { isStoreOpen, storeCodeFromName } from "@/server/services/nebim/calendar";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

/**
 * Bir mağaza+tarih için DailyRecord var ise dön, yoksa "draft" olarak oluştur.
 * Aynı (store_id, date) için unique constraint olduğu için upsert güvenli.
 */
export async function getOrCreateDailyRecord(
  prisma: PrismaClient,
  storeId: string,
  date: string // YYYY-MM-DD
) {
  // Date string'i UTC midnight olarak parse et
  const day = new Date(`${date}T00:00:00.000Z`);
  const dr = await prisma.dailyRecord.upsert({
    where: { store_id_date: { store_id: storeId, date: day } },
    update: {},
    create: {
      store_id: storeId,
      date: day,
      status: "draft",
    },
  });
  // Every write to a day comes through here. A day closed as "satış olmadı"
  // takes no document, from anyone: a sale and "no sale" cannot both be true.
  if (dr.no_sales) {
    throw new TRPCError({ code: "BAD_REQUEST", message: NO_SALES_CLOSED_MESSAGE });
  }
  return dr;
}

export const NO_SALES_CLOSED_MESSAGE =
  'Bu gün "satış olmadı" olarak kapatıldı; belge ya da tutar eklenemez. ' +
  "Satış olduysa önce yönetici günün kilidini açmalı.";

// ─────────────────────────────────────────────────────────────
// SATIŞ OLMADI — gün tek tuşla 0,00 ile kapanır (sahibi, 10.11.2026)
// ─────────────────────────────────────────────────────────────

/** Europe/Istanbul takvim günü (KKTC = TR saati), YYYY-MM-DD. */
export function todayIstanbul(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export type NoSalesFacts = {
  date: string; // YYYY-MM-DD
  today: string; // YYYY-MM-DD
  status: string | null; // gün kaydı yoksa null
  no_sales: boolean;
  merged: boolean; // gün birleşmesi ya da kümülatif kasa zincirinde
  /** Başarısız olmayan yükleme sayısı (Z, POS, özet, dekont, bayi dosyası…). */
  documents: number;
  manual_invoices: number;
  corporate_purchases: number;
  /** Sayılan nakit + hediye çekleri (0 kaydı içerik sayılmaz). */
  typed_amounts: number;
  nebim_lines: number;
  nebim_net: number;
};

const money = (n: number) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Gün "satış olmadı" diye neden kapatılamaz? Kapatılabiliyorsa null.
 * Kural tek: o güne ait satış izi olan hiçbir şey bulunmamalı. Masraf ve
 * avans engel değildir — satışsız günde de kasadan ödeme yapılabilir.
 */
export function noSalesBlocker(f: NoSalesFacts): string | null {
  if (f.date > f.today) return "Henüz gelmemiş bir gün kapatılamaz.";
  if (f.no_sales) return 'Bu gün zaten "satış olmadı" olarak kapatıldı.';
  if (f.status === "locked") return "Bu gün zaten kilitli.";
  if (f.merged) {
    return "Bu gün başka günlerle birlikte kapanacak (birleşme). Önce birleşmeyi kaldırın.";
  }
  if (f.nebim_lines > 0) {
    return (
      `Nebim'de bu gün ${f.nebim_lines} satır, net ${money(f.nebim_net)} ₺ işlem görünüyor. ` +
      'Satış olan gün "satış olmadı" diye kapatılamaz; belgeleri yükleyin.'
    );
  }
  if (f.documents > 0) {
    return (
      `Bu güne yüklenmiş ${f.documents} belge var. ` +
      'Satış olmadıysa önce belgeleri silin, sonra "satış olmadı" deyin.'
    );
  }
  if (f.manual_invoices > 0) return "Bu günde el faturası var; satış olan gün böyle kapatılamaz.";
  if (f.corporate_purchases > 0) {
    return "Bu günde kurumsal alışveriş kaydı var; satış olan gün böyle kapatılamaz.";
  }
  if (f.typed_amounts > 0) {
    return "Bu günde sayılmış nakit ya da hediye çeki tutarı girilmiş. Önce onları sıfırlayın.";
  }
  return null;
}

export async function loadNoSalesFacts(
  prisma: PrismaClient,
  storeId: string,
  date: string
): Promise<NoSalesFacts & { id: string | null }> {
  const day = new Date(`${date}T00:00:00.000Z`);
  const [dr, nebim] = await Promise.all([
    prisma.dailyRecord.findUnique({
      where: { store_id_date: { store_id: storeId, date: day } },
      select: {
        id: true,
        status: true,
        no_sales: true,
        merge_group_id: true,
        cumulative_prev_id: true,
        reported_cash_try: true,
        gift_voucher_try: true,
        mavi_gift_voucher_try: true,
        _count: {
          select: {
            uploads: { where: { status: { not: "failed" } } },
            manual_invoices: true,
            corporate_purchases: true,
            cumulative_next: true,
          },
        },
      },
    }),
    // `prisma` is scoped to completed sales; a sale parked at the till is not one.
    prisma.nebimSaleLine.aggregate({
      where: { store_id: storeId, invoice_date: day },
      _count: { _all: true },
      _sum: { net_amount: true },
    }),
  ]);
  const n = (d: { toNumber(): number } | null | undefined) => d?.toNumber() ?? 0;
  return {
    id: dr?.id ?? null,
    date,
    today: todayIstanbul(),
    status: dr?.status ?? null,
    no_sales: dr?.no_sales ?? false,
    merged: !!dr && (!!dr.merge_group_id || !!dr.cumulative_prev_id || dr._count.cumulative_next > 0),
    documents: dr?._count.uploads ?? 0,
    manual_invoices: dr?._count.manual_invoices ?? 0,
    corporate_purchases: dr?._count.corporate_purchases ?? 0,
    typed_amounts: dr
      ? n(dr.reported_cash_try) + n(dr.gift_voucher_try) + n(dr.mavi_gift_voucher_try)
      : 0,
    nebim_lines: nebim._count._all,
    nebim_net: Math.round(n(nebim._sum.net_amount) * 100) / 100,
  };
}

/**
 * Günü "satış olmadı" olarak kapatır: kayıt yoksa açar, 0,00 ile kilitler.
 * Eski bir mutabakat satırı kalmışsa (belgeleri silinmiş gün) temizlenir —
 * kapanışın kendisi mutabakattır, karşılaştırılacak belge yoktur.
 */
export async function closeDayNoSales(
  prisma: PrismaClient,
  userId: string,
  storeId: string,
  date: string
) {
  const facts = await loadNoSalesFacts(prisma, storeId, date);
  const blocker = noSalesBlocker(facts);
  if (blocker) throw new TRPCError({ code: "BAD_REQUEST", message: blocker });

  const day = new Date(`${date}T00:00:00.000Z`);
  const now = new Date();
  const closed = {
    status: "locked" as const,
    no_sales: true,
    approved_by: userId,
    approved_at: now,
    locked_at: now,
  };
  return prisma.$transaction(async (tx) => {
    const dr = await tx.dailyRecord.upsert({
      where: { store_id_date: { store_id: storeId, date: day } },
      update: closed,
      create: { store_id: storeId, date: day, ...closed },
    });
    await tx.verification.deleteMany({ where: { daily_record_id: dr.id } });
    return dr;
  });
}

/**
 * KİLİTLEME ZORUNLULUĞU.
 *
 * Müdür/kasiyer her günün sonunda yüklemelerini bitirip günü kilitlemek
 * zorundadır. Bunu mecbur kılmak için: yeni bir güne kayıt girilirken, aynı
 * mağazada DAHA ESKİ ve hâlâ kilitlenmemiş bir gün varsa işlem reddedilir —
 * önce o gün kapatılmalıdır.
 *
 * `LOCK_ENFORCEMENT_FROM` öncesi günler muaftır: sistem test aşamasında
 * açılan günler geriye dönük kilitlenmek zorunda kalmasın. Zorunluluğu
 * ileri/geri almak için tek yapılacak bu tarihi değiştirmek.
 *
 * Admin muaftır — geçmişe dönük düzeltme yapabilmesi gerekir.
 */
// Go-live day for the stores (Derimod Lefkoşa first, 16.09.2026). Days before
// it were the admin's test uploads and must not block the manager's first day.
export const LOCK_ENFORCEMENT_FROM = "2026-09-16";

export async function assertPriorDaysLocked(
  prisma: PrismaClient,
  user: { role: string },
  storeId: string,
  date: string // YYYY-MM-DD — kayıt girilmek istenen gün
): Promise<void> {
  if (user.role === "admin") return;
  if (date <= LOCK_ENFORCEMENT_FROM) return;

  // Days of the same merge group (Derimod "Gün Birleşmesi") are closed
  // together by the group's summary day; a sibling must never block the
  // next sibling, or step 2 of the wizard is dead.
  const target = await prisma.dailyRecord.findUnique({
    where: { store_id_date: { store_id: storeId, date: new Date(`${date}T00:00:00.000Z`) } },
    select: { merge_group_id: true },
  });
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { name: true, brand: { select: { name: true } } },
  });
  const storeCode = store ? storeCodeFromName(store.name) : null;

  const candidates = await prisma.dailyRecord.findMany({
    where: {
      store_id: storeId,
      date: {
        gte: new Date(`${LOCK_ENFORCEMENT_FROM}T00:00:00.000Z`),
        lt: new Date(`${date}T00:00:00.000Z`),
      },
      status: { not: "locked" },
      ...(target?.merge_group_id
        ? { NOT: { merge_group_id: target.merge_group_id } }
        : {}),
      // BOŞ gün kaydı kilit istemez. Bir yükleme başlatılıp silinince ya da
      // kapalı bir güne (Derimod Mağusa pazarları) yanlışlıkla dokunulunca
      // içi boş bir "draft" kalıyor; bunu kilitlemeye zorlamak müdürü hiç
      // yaşanmamış bir gün için engellerdi (30.08.2026 Mağusa'da görüldü).
      // "Dolu" = en az bir başarısız-olmayan yükleme, elle girilmiş bir
      // belge, sayılmış nakit / çek tutarı ya da taslaktan çıkmış durum.
      OR: [
        { status: { not: "draft" } },
        { uploads: { some: { status: { not: "failed" } } } },
        { manual_invoices: { some: {} } },
        { cash_advances: { some: {} } },
        { corporate_purchases: { some: {} } },
        { expenses: { some: {} } },
        // A saved 0 (a closed Sunday touched by mistake) is not content.
        { reported_cash_try: { gt: 0 } },
        { gift_voucher_try: { gt: 0 } },
        { mavi_gift_voucher_try: { gt: 0 } },
      ],
    },
    orderBy: { date: "asc" },
    select: {
      date: true,
      merge_group: { select: { start_date: true, end_date: true } },
      store_summary: { select: { id: true } },
    },
  });
  // A closed day (Derimod Mağusa Sundays) never needs locking.
  const open = candidates.find(
    (c) => isStoreOpen(storeCode, c.date)
  );
  if (!open) return;

  const fmt = (d: Date) =>
    d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  const tr = fmt(open.date);
  // A day inside a merge group cannot be locked on its own: the group's
  // summary goes on its LAST day and locks all of them. Sending the manager
  // to "lock 20.09" when 20–21.09 were merged led nowhere.
  if (open.merge_group) {
    const a = fmt(open.merge_group.start_date);
    const b = fmt(open.merge_group.end_date);
    // Mavi reaches a merge from the "Kasa Birleşmesi" card on the ordinary
    // day page — there is no wizard tab to send the manager to.
    if (store?.brand.name.toLowerCase().includes("mavi")) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          `${a} – ${b} günleri birlikte kapatılacak (kasa birleşmesi) ve henüz kilitlenmedi; ` +
          `kapatılmayan gün varken yeni güne kayıt girilemez. Tarih alanından ${b} gününe gidin: ` +
          `mağaza özetini ve bayi gün sonu dosyasını yükleyip sayfanın altındaki "Günü Kilitle" ` +
          `düğmesine basın; günlerin hepsi birlikte kilitlenir.`,
      });
    }
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        `${a} – ${b} gün birleşmesi henüz kapatılmadı; kapatılmayan gün varken yeni güne ` +
        `kayıt girilemez. "Gün Birleşmesi" sekmesine geçin — kaldığınız yerden devam eder: ` +
        `son güne (${b}) mağaza özetini yükleyip sayfanın altındaki "Günü Kilitle" düğmesine basın; ` +
        `birleşmenin tüm günleri birlikte kilitlenir.`,
    });
  }
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: priorDayLockMessage({
      day: tr,
      isMavi: !!store?.brand.name.toLowerCase().includes("mavi"),
      hasSummary: !!open.store_summary,
    }),
  });
}

/**
 * "Önce şu günü kilitle" mesajı. Mavi'de açık günün mağaza özeti YOKSA o gün
 * tek başına hiç kilitlenemeyebilir: kasa kapatılamadıysa özet ertesi güne
 * gelir, ama ertesi güne de bu kapı yüzünden kayıt girilemez. Mağaza çıkışı
 * bulamadan dört gün takıldı (Mavi Güzelyurt, 01–05.10.2026) — mesaj artık
 * çıkışı söyler.
 */
export function priorDayLockMessage(a: { day: string; isMavi: boolean; hasSummary: boolean }): string {
  const base =
    `Önce ${a.day} gününü kilitlemelisin. Her gün, yüklemeler bitince ` +
    `"Günü Kilitle" ile kapatılmak zorundadır — kapatılmayan gün varken ` +
    `yeni güne kayıt girilemez. Tarih alanından ${a.day} gününe gidip sayfanın ` +
    `altındaki "Günü Kilitle" düğmesine basın.`;
  if (!a.isMavi || a.hasSummary) return base;
  return (
    base +
    ` Kasa o gün kapatılamadıysa (mağaza özeti yoksa): ${a.day} sayfasındaki "Kasa Birleşmesi" ` +
    `kartından "Bu günün özeti yok — ertesi günle kapanacak" deyin; günler tek özetle birlikte kapanır ` +
    `ve ertesi güne kayıt girebilirsiniz.`
  );
}
