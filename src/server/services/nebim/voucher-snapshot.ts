import "server-only";
import type { PrismaClient } from "@prisma/client";

/**
 * Which credit-voucher cards no longer exist in Nebim.
 *
 * The bridge posts the WHOLE cdGiftCard table on every run (~5k rows,
 * upsert, so every surviving card's updated_at moves forward each day).
 * Nebim deletes a card outright when the return that issued it is
 * cancelled — measured 2026-09-07: of 5.063 cards, exactly one (CV…5954,
 * issued 31.08 09:58 for return 1-R-7-92614, which the customer redid at
 * 18:56) had not been touched since the day it appeared, and it was the
 * one still showing ₺1.499,99 "open" in DocuFlow. The bridge never deletes,
 * so a card the snapshot stopped mentioning is the signal.
 *
 * "Missing" = updated_at more than 12 h behind the newest card. The bridge
 * posts cards in chunks of 2.000 within a minute, so a healthy run keeps
 * every card inside the window; a run that never comes moves the cutoff
 * with it. The issuing transaction of a missing card is a payment line of
 * a cancelled document and is excluded along with it.
 */
export async function missingVoucherSerials(
  prisma: PrismaClient
): Promise<{ cutoff: Date | null; serials: string[] }> {
  const latest = await prisma.nebimVoucher.aggregate({ _max: { updated_at: true } });
  const newest = latest._max.updated_at;
  if (!newest) return { cutoff: null, serials: [] };
  const cutoff = new Date(newest.getTime() - 12 * 60 * 60 * 1000);
  const stale = await prisma.nebimVoucher.findMany({
    where: { updated_at: { lt: cutoff } },
    select: { serial: true },
  });
  return { cutoff, serials: stale.map((s) => s.serial) };
}
