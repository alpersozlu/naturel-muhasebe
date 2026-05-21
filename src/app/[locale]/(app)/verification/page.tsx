"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import {
  VerificationFilters,
  type VerificationSelection,
} from "@/components/verification/filters";
import { DayList } from "@/components/verification/day-list";
import { CashVarianceBlock } from "@/components/verification/cash-variance-block";
import { trpc } from "@/lib/trpc";

export default function VerificationPage() {
  const now = new Date();
  const [sel, setSel] = useState<VerificationSelection>({
    brandId: "",
    storeId: "",
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });

  // Kilidi açma yetkisi sadece admin'de
  const { data: health } = trpc.health.useQuery(undefined, { staleTime: Infinity });
  // Health'ten kullanıcı bilgisi gelmiyor; client'ta canUnlock'u her zaman true bırakıp
  // server tarafında admin check yapıyoruz (zaten dailyRecord.unlock admin-only).
  const canUnlock = !!health;

  return (
    <div>
      <PageHeader
        title="Doğrulama Sistemi"
        description="Mağazalar genelindeki günlük doğrulama durumunu takip edin."
      />
      <VerificationFilters value={sel} onChange={setSel} />
      <CashVarianceBlock
        brandId={sel.brandId}
        storeId={sel.storeId}
        year={sel.year}
        month={sel.month}
      />
      <DayList
        storeId={sel.storeId}
        year={sel.year}
        month={sel.month}
        canUnlock={canUnlock}
      />
    </div>
  );
}
