import "server-only";
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
export const LOCK_ENFORCEMENT_FROM = "2026-09-01";

export async function assertPriorDaysLocked(
  prisma: PrismaClient,
  user: { role: string },
  storeId: string,
  date: string // YYYY-MM-DD — kayıt girilmek istenen gün
): Promise<void> {
  if (user.role === "admin") return;
  if (date <= LOCK_ENFORCEMENT_FROM) return;

  const open = await prisma.dailyRecord.findFirst({
    where: {
      store_id: storeId,
      date: {
        gte: new Date(`${LOCK_ENFORCEMENT_FROM}T00:00:00.000Z`),
        lt: new Date(`${date}T00:00:00.000Z`),
      },
      status: { not: "locked" },
    },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  if (!open) return;

  const tr = open.date.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      `Önce ${tr} gününü kilitlemelisin. Her gün, yüklemeler bitince ` +
      `"Günü Kilitle" ile kapatılmak zorundadır — kapatılmayan gün varken ` +
      `yeni güne kayıt girilemez.`,
  });
}
