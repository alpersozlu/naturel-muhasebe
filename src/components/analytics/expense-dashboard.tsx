"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LineChart,
  Line,
  Cell,
} from "recharts";
import { Wallet, Receipt, Users, Store } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "./stat-card";

const TRY = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const TRY2 = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const CATEGORY_LABEL: Record<string, string> = {
  rent: "Kira",
  electricity: "Elektrik",
  water: "Su",
  internet: "İnternet",
  stationery: "Kırtasiye",
  cleaning: "Temizlik",
  maintenance: "Bakım",
  salary: "Maaş",
  bonus: "Prim/Avans",
  supplies: "Sarf Malzeme",
  marketing: "Pazarlama",
  other: "Diğer",
};

const COLORS = ["#EF4444", "#F59E0B", "#8B5CF6", "#10B981", "#84CC16", "#06B6D4", "#EC4899", "#0EA5E9"];

export function ExpenseDashboard({
  brandId,
  storeId,
  year,
  month,
}: {
  brandId: string;
  storeId: string;
  year: number;
  month: number;
}) {
  const { data, isLoading } = trpc.analytics.expense.useQuery({
    brand_id: brandId || undefined,
    store_id: storeId || undefined,
    year,
    month,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground text-sm">
          Yükleniyor...
        </CardContent>
      </Card>
    );
  }

  if (!data || data.total === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          <Wallet className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">Bu ay için gider verisi yok</div>
          <div className="text-sm mt-1">
            Masraf/Fatura veya Peşin Ödeme girildikten sonra burada gözükür.
          </div>
        </CardContent>
      </Card>
    );
  }

  const topCategory = data.by_category[0];
  const topStore = data.by_store[0];
  const topEmployee = data.by_employee[0];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Wallet}
          label="Toplam Gider"
          value={data.total}
          color="text-rose-600"
          bgColor="bg-rose-50"
          hint={`${data.count} kayıt`}
        />
        <StatCard
          icon={Receipt}
          label={topCategory ? CATEGORY_LABEL[topCategory.category] : "—"}
          value={topCategory?.total ?? 0}
          color="text-amber-600"
          bgColor="bg-amber-50"
          hint="En çok harcanan kategori"
        />
        <StatCard
          icon={Store}
          label={topStore?.store_name ?? "—"}
          value={topStore?.total ?? 0}
          color="text-indigo-600"
          bgColor="bg-indigo-50"
          hint="En çok harcayan mağaza"
        />
        <StatCard
          icon={Users}
          label={topEmployee?.employee_name ?? "—"}
          value={topEmployee?.total ?? 0}
          color="text-purple-600"
          bgColor="bg-purple-50"
          hint="En çok harcayan çalışan"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="font-semibold mb-1">Aylık Trend</div>
            <div className="text-xs text-muted-foreground mb-4">
              Son 6 ay toplam gider
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.monthly_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${TRY.format(v / 1000)}K`}
                />
                <Tooltip
                  formatter={(v) => [`${TRY2.format(Number(v))} ₺`, "Toplam"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="#8B5CF6"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "#8B5CF6" }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="font-semibold mb-1">Kategori Dağılımı</div>
            <div className="text-xs text-muted-foreground mb-4">
              Bu ay kategori bazında
            </div>
            <ResponsiveContainer width="100%" height={Math.max(180, data.by_category.length * 32)}>
              <BarChart
                data={data.by_category.map((c) => ({
                  ...c,
                  label: CATEGORY_LABEL[c.category] ?? c.category,
                }))}
                layout="vertical"
                margin={{ left: 10 }}
              >
                <XAxis
                  type="number"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${TRY.format(v / 1000)}K`}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={100}
                />
                <Tooltip
                  formatter={(v) => [`${TRY2.format(Number(v))} ₺`, "Gider"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                  {data.by_category.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="font-semibold mb-1">Çalışana Göre</div>
            <div className="text-xs text-muted-foreground mb-4">
              Kişi başına harcama
            </div>
            {data.by_employee.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                Veri yok
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(180, data.by_employee.length * 36)}>
                <BarChart data={data.by_employee} layout="vertical" margin={{ left: 10 }}>
                  <XAxis
                    type="number"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${TRY.format(v / 1000)}K`}
                  />
                  <YAxis
                    type="category"
                    dataKey="employee_name"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={120}
                  />
                  <Tooltip
                    formatter={(v) => [`${TRY2.format(Number(v))} ₺`, "Gider"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="total" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="font-semibold mb-1">Mağazaya Göre</div>
            <div className="text-xs text-muted-foreground mb-4">
              Mağaza başına harcama
            </div>
            {data.by_store.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                Veri yok
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(180, data.by_store.length * 36)}>
                <BarChart data={data.by_store} layout="vertical" margin={{ left: 10 }}>
                  <XAxis
                    type="number"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${TRY.format(v / 1000)}K`}
                  />
                  <YAxis
                    type="category"
                    dataKey="store_name"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={100}
                  />
                  <Tooltip
                    formatter={(v) => [`${TRY2.format(Number(v))} ₺`, "Gider"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="total" fill="#6366F1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
