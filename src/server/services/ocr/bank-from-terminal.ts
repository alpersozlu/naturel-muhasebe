import "server-only";
import { prisma } from "@/lib/prisma";
import { bankKey, normTerminal } from "@/server/services/authenticity/assess";

/**
 * Bank name from the store's own history of the same terminal. The bank
 * is often printed only as a logo; Mavi Girne 23.09.2026 (Garanti BBVA,
 * terminal 01088088) came back as "Koopbank", "Bilinmiyor" and "Naturel
 * Ticaret" in three reads, while the same terminal was stored as Garanti
 * BBVA in May. When the slip shows no readable bank (or only the store's own
 * name), a terminal that has always meant ONE bank in this store supplies it.
 */
const MERCHANT_LIKE = /naturel|nat[uü]rel|mavi|jeans|derimod|ticaret|bilinmiyor|unknown|belirsiz/i;

export async function resolveBankFromTerminalHistory(
  dailyRecordId: string,
  sections: Array<{ bank_name: string; terminal_no?: string | null }>
): Promise<void> {
  try {
    const withTerminal = sections.filter((s) => s.terminal_no && normTerminal(s.terminal_no).length >= 5);
    if (withTerminal.length === 0) return;
    const dr = await prisma.dailyRecord.findUnique({ where: { id: dailyRecordId }, select: { store_id: true } });
    if (!dr) return;
    const history = await prisma.posSlip.findMany({
      where: { daily_record: { store_id: dr.store_id }, daily_record_id: { not: dailyRecordId }, terminal_no: { not: null }, bank_name: { not: null } },
      select: { bank_name: true, terminal_no: true },
      take: 1000,
    });
    for (const sec of withTerminal) {
      const t = normTerminal(sec.terminal_no!);
      const same = history.filter((h) => normTerminal(h.terminal_no!) === t);
      const families = new Map<string, string>();
      for (const h of same) {
        const k = bankKey(h.bank_name);
        if (k && !MERCHANT_LIKE.test(h.bank_name!)) families.set(k, h.bank_name!);
      }
      if (families.size !== 1) continue; // unknown terminal, or a shared one
      const [key, name] = Array.from(families.entries())[0]!;
      const current = sec.bank_name?.trim() ?? "";
      // Only an unread bank is filled. A bank name that WAS read is never
      // replaced: one PAX device can print Koopbank (Optimum) and Yapı Kredi
      // under the same terminal number, and a store's history may so far
      // hold only one of them (measured: two Koopbank slips were turned into
      // Yapı Kredi when a read name was allowed to be overridden).
      if (!current || MERCHANT_LIKE.test(current)) {
        // A multi-bank slip keeps its sections apart: never rename a section
        // into a bank another section of the same slip already carries.
        if (sections.some((o) => o !== sec && bankKey(o.bank_name) === key)) continue;
        sec.bank_name = name;
      }
    }
  } catch (e) {
    console.error("[OCR] bank-from-terminal lookup failed", e instanceof Error ? e.message : e);
  }
}

