"use client";

import { PageHeader } from "@/components/shared/page-header";
import { PeopleCountDashboard } from "@/components/people-count/people-count-dashboard";

export default function PeopleCountPage() {
  return (
    <div>
      <PageHeader
        title="Kişi Sayımı"
        description="Mağaza kamerasından otomatik aktarılan giren-çıkan sayıları. Saatlik karşılaştırma ve günlük trend."
      />
      <PeopleCountDashboard />
    </div>
  );
}
