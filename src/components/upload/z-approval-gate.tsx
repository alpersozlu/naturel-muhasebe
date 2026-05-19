"use client";

import { trpc } from "@/lib/trpc";
import type { ZReport } from "@prisma/client";
import { ZReportDetails } from "./parsed-details";

/**
 * Wraps ZReportDetails with a live-pulled approval status from the
 * server. Re-queries when ManualInvoice list changes (parent
 * invalidates upload list, which cascades here).
 */
export function ZApprovalGate({
  uploadId,
  data,
  dateMismatch,
  expectedDate,
}: {
  uploadId: string;
  data: ZReport;
  dateMismatch?: boolean;
  expectedDate?: Date | string;
}) {
  const { data: approval } = trpc.upload.zApprovalCheck.useQuery(
    { id: uploadId },
    { staleTime: 0, refetchOnWindowFocus: true }
  );

  return (
    <ZReportDetails
      data={data}
      dateMismatch={dateMismatch}
      expectedDate={expectedDate}
      approval={approval ?? undefined}
    />
  );
}
