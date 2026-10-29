import "server-only";
import type { PrismaClient } from "@prisma/client";
import { optimumShareOf, type OptimumShare, type SlipLike } from "@/lib/optimum-share";

type SlipRow = SlipLike & { upload: { status: string } };

/** Yalnız okunmuş/onaylı yüklemelerin fişleri sayılır (computeDay ile aynı). */
export function optimumShareOfRecords(records: Array<{ pos_slips: SlipRow[] }>): OptimumShare {
  const slips = records
    .flatMap((r) => r.pos_slips)
    .filter((p) => p.upload.status === "parsed" || p.upload.status === "confirmed");
  return optimumShareOf(slips);
}

/** Günün (birleşik grupsa tüm günlerin) Optimum payı. */
export async function computeOptimumShare(prisma: PrismaClient, dailyRecordId: string): Promise<OptimumShare> {
  const base = await prisma.dailyRecord.findUnique({ where: { id: dailyRecordId }, select: { merge_group_id: true } });
  if (!base) return optimumShareOf([]);
  const records = await prisma.dailyRecord.findMany({
    where: base.merge_group_id ? { merge_group_id: base.merge_group_id } : { id: dailyRecordId },
    select: { pos_slips: { select: { bank_name: true, net_amount_try: true, upload: { select: { status: true } } } } },
  });
  return optimumShareOfRecords(records);
}
