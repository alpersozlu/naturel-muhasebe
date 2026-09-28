import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prismaBase: PrismaClient | undefined;
};

const base =
  globalForPrisma.prismaBase ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaBase = base;
}

/**
 * Reads of NebimSaleLine see only COMPLETED invoices unless the caller says
 * otherwise. A sale parked at the POS ("askıya alındı") arrives from the
 * bridge with is_completed=false; it must not count as revenue anywhere
 * (~30 aggregations across the sales list, verification, analytics), so the
 * filter lives here rather than in every query.
 *
 * Opt out by naming `is_completed` in the where clause (the list's "Askıda"
 * view passes `is_completed: false`), or use `prismaUnscoped` (the ingest
 * route, which owns every row).
 */
const SCOPED_READS = new Set(["findMany", "findFirst", "count", "aggregate", "groupBy"]);

export const prisma = base.$extends({
  query: {
    nebimSaleLine: {
      $allOperations({ operation, args, query }) {
        if (SCOPED_READS.has(operation)) {
          const a = args as { where?: Prisma.NebimSaleLineWhereInput };
          if (!a.where || !("is_completed" in a.where)) {
            a.where = { ...(a.where ?? {}), is_completed: true };
          }
        }
        return query(args);
      },
    },
  },
}) as unknown as PrismaClient;

/** The same connection, without the completed-only scope on NebimSaleLine. */
export const prismaUnscoped: PrismaClient = base;
