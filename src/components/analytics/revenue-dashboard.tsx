"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import { Banknote, CreditCard, TrendingUp, Wallet } from "lucide-react";
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

const POS_COLOR = "#6366F1"; // indigo-500
const CASH_COLOR = "#10B981"; // emerald-500
const BANK_COLORS = ["#6366F1", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#0EA5E9"];

export function RevenueDashboard({
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
  const { data, isLoading } = trpc.analytics.revenue.useQuery({
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

  if (!data) return null;

  const isEmpty = data.total === 0 && data.active_days === 0;

  if (isEmpty) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          <Banknote className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">Bu ay için gelir verisi yok</div>
          <div className="text-sm mt-1">
            Mağaza Özeti yüklendikten sonra burada gözükür.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={TrendingUp}
          label="Toplam Gelir"
          value={data.total}
          color="text-indigo-600"
          bgColor="bg-indigo-50"
          hint={`${data.active_days} aktif gün`}
        />
        <StatCard
          icon={Wallet}
          label="Nakit Gelir"
          value={data.cash}
          color="text-emerald-600"
          bgColor="bg-emerald-50"
          hint={
            data.total > 0
              ? `${((data.cash / data.total) * 100).toFixed(1)}% pay`
              : undefined
          }
        />
        <StatCard
          icon={CreditCard}
          label="POS Gelir"
          value={data.pos}
          color="text-purple-600"
          bgColor="bg-purple-50"
          hint={
            data.total > 0
              ? `${((data.pos / data.total) * 100).toFixed(1)}% pay`
              : undefined
          }
        />
        <StatCard
          icon={Banknote}
          label="Günlük Ortalama"
          value={data.daily_avg}
          color="text-amber-600"
          bgColor="bg-amber-50"
          hint={`${data.active_days} gün üzerinden`}
        />
      </div>

      {/* Daily series */}
      <Card>
        <CardContent className="p-5">
          <div className="font-semibold mb-1">Günlük Görünüm</div>
          <div className="text-xs text-muted-foreground mb-4">
            Ay boyunca nakit ve POS dağılımı
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.daily_series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="day" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${TRY.format(v / 1000)}K`}
              />
              <Tooltip
                formatter={(v) => [`${TRY2.format(Number(v))} ₺`, ""]}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}
                labelFormatter={(d) => `Gün ${d}`}
              />
              <Bar dataKey="cash" stackId="a" fill={CASH_COLOR} name="Nakit" radius={[0, 0, 0, 0]} />
              <Bar dataKey="pos" stackId="a" fill={POS_COLOR} name="POS" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Side panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="font-semibold mb-1">Mağaza Bazında Gelir</div>
            <div className="text-xs text-muted-foreground mb-4">
              Bu ay aktif olan mağazalar
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
                    formatter={(v) => [`${TRY2.format(Number(v))} ₺`, "Gelir"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                    {data.by_store.map((_, i) => (
                      <Cell key={i} fill={BANK_COLORS[i % BANK_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="font-semibold mb-1">Banka Bazında POS</div>
            <div className="text-xs text-muted-foreground mb-4">
              Hangi banka pos'undan ne kadar geldi
            </div>
            {data.by_bank.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                Veri yok
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(180, data.by_bank.length * 36)}>
                <BarChart data={data.by_bank} layout="vertical" margin={{ left: 10 }}>
                  <XAxis
                    type="number"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${TRY.format(v / 1000)}K`}
                  />
                  <YAxis
                    type="category"
                    dataKey="bank_name"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={110}
                  />
                  <Tooltip
                    formatter={(v) => [`${TRY2.format(Number(v))} ₺`, "POS"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="total" fill={POS_COLOR} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
