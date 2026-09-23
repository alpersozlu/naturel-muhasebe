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
  return prisma.dailyRecord.upsert({
    where: { store_id_date: { store_id: storeId, date: day } },
    update: {},
    create: {
      store_id: storeId,
      date: day,
      status: "draft",
    },
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
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { name: true } });
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
    select: { date: true, merge_group: { select: { start_date: true, end_date: true } } },
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
    message:
      `Önce ${tr} gününü kilitlemelisin. Her gün, yüklemeler bitince ` +
      `"Günü Kilitle" ile kapatılmak zorundadır — kapatılmayan gün varken ` +
      `yeni güne kayıt girilemez. Tarih alanından ${tr} gününe gidip sayfanın ` +
      `altındaki "Günü Kilitle" düğmesine basın.`,
  });
}
