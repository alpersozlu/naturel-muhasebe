"use client";

import { Building2, Store, Users, Briefcase } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export function AdminStats() {
  const { data } = trpc.brand.list.useQuery();
  const brandCount = data?.length ?? 0;
  const storeCount = data?.reduce((sum, b) => sum + b._count.stores, 0) ?? 0;

  const items = [
    { icon: Building2, label: "Markalar", value: brandCount, color: "text-indigo-600" },
    { icon: Store, label: "Mağazalar", value: storeCount, color: "text-emerald-600" },
    { icon: Users, label: "Mağaza Müdürleri", value: 0, color: "text-amber-600" },
    { icon: Briefcase, label: "Satış Temsilcileri", value: 0, color: "text-teal-600" },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {items.map(({ icon: Icon, label, value, color }) => (
        <Card key={label}>
          <CardContent className="pt-6">
            <Icon className={`h-6 w-6 mb-3 ${color}`} />
            <div className="text-3xl font-bold">{value}</div>
            <div className="text-sm text-muted-foreground mt-1">{label}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
