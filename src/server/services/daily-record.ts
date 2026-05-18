import "server-only";
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
