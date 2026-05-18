"use client";

import { Building2, Store, Users, Briefcase } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";

export function AdminStats() {
  const { data: brands } = trpc.brand.list.useQuery();
  const { data: users } = trpc.user.list.useQuery();

  const brandCount = brands?.length ?? 0;
  const storeCount = brands?.reduce((sum, b) => sum + b._count.stores, 0) ?? 0;
  const managerCount =
    users?.filter((u) => u.role === "store_manager" || u.role === "cashier").length ?? 0;
  const salesRepCount = users?.filter((u) => u.role === "sales_rep").length ?? 0;

  const items = [
    {
      icon: Building2,
      label: "Markalar",
      value: brandCount,
      color: "text-indigo-600",
      href: "/admin",
    },
    {
      icon: Store,
      label: "Mağazalar",
      value: storeCount,
      color: "text-emerald-600",
      href: "/admin",
    },
    {
      icon: Users,
      label: "Mağaza Müdürleri",
      value: managerCount,
      color: "text-amber-600",
      href: "/admin/users",
    },
    {
      icon: Briefcase,
      label: "Satış Temsilcileri",
      value: salesRepCount,
      color: "text-teal-600",
      href: "/admin/users",
    },
  ] as const;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {items.map(({ icon: Icon, label, value, color, href }) => (
        <Link key={label} href={href} className="block">
          <Card className="hover:border-primary/50 hover:shadow-sm transition-all">
            <CardContent className="pt-6">
              <Icon className={`h-6 w-6 mb-3 ${color}`} />
              <div className="text-3xl font-bold">{value}</div>
              <div className="text-sm text-muted-foreground mt-1">{label}</div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
