import { z } from "zod";
import { router, adminProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";

/**
 * Kişi sayımı — mağaza kamerasından aktarılan saatlik giren/çıkan verisi.
 *
 * Veri PeopleCountHour tablosuna /api/ingest/people-count üzerinden düşer
 * (KisiSayimKopru). Buradaki query'ler paneli besler; date alanları kamera
 * YEREL günü olduğu için istemci "bugün"ü kendi saatine göre gönderir.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD gününe gün ekle/çıkar (TZ'den bağımsız, UTC üzerinden). */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const hourRows = (store_code: string | undefined, date: string) =>
  prisma.peopleCountHour.findMany({
    where: { ...(store_code ? { store_code } : {}), date },
    orderBy: { hour: "asc" },
    select: { hour: true, enter: true, exit: true, updated_at: true },
  });

export const peopleCountRouter = router({
  /** Panelde görünen mağazalar (veri gelmiş store_code'lar). */
  stores: adminProcedure.query(async () => {
    const rows = await prisma.peopleCountHour.groupBy({ by: ["store_code"] });
    return rows.map((r) => r.store_code).sort();
  }),

  /** Bugün / dün / geçen hafta aynı gün — saatlik seriler tek çağrıda. */
  summary: adminProcedure
    .input(
      z.object({
        store_code: z.string().trim().min(1).optional(),
        date: z.string().regex(DATE_RE),
      })
    )
    .query(async ({ input }) => {
      const { store_code, date } = input;
      const dun = addDays(date, -1);
      const gecenHafta = addDays(date, -7);
      const [bugunRows, dunRows, gecenHaftaRows] = await Promise.all([
        hourRows(store_code, date),
        hourRows(store_code, dun),
        hourRows(store_code, gecenHafta),
      ]);
      const sonGuncelleme = bugunRows.reduce<Date | null>(
        (acc, r) => (acc && acc > r.updated_at ? acc : r.updated_at),
        null
      );
      const strip = (rows: typeof bugunRows) =>
        rows.map(({ hour, enter, exit }) => ({ hour, enter, exit }));
      return {
        bugun: { date, rows: strip(bugunRows) },
        dun: { date: dun, rows: strip(dunRows) },
        gecenHafta: { date: gecenHafta, rows: strip(gecenHaftaRows) },
        sonGuncelleme,
      };
    }),

  /** Günlük toplamlar — trend grafiği (endDate dahil, geriye `days` gün). */
  daily: adminProcedure
    .input(
      z.object({
        store_code: z.string().trim().min(1).optional(),
        endDate: z.string().regex(DATE_RE),
        days: z.number().int().min(1).max(730),
      })
    )
    .query(async ({ input }) => {
      const { store_code, endDate, days } = input;
      const startDate = addDays(endDate, -(days - 1));
      const grouped = await prisma.peopleCountHour.groupBy({
        by: ["date"],
        where: {
          ...(store_code ? { store_code } : {}),
          date: { gte: startDate, lte: endDate },
        },
        _sum: { enter: true, exit: true },
        orderBy: { date: "asc" },
      });
      return grouped.map((g) => ({
        date: g.date,
        enter: g._sum.enter ?? 0,
        exit: g._sum.exit ?? 0,
      }));
    }),
});
