"use client";

import { useState } from "react";
import {
  Loader2,
  User,
  UserCircle2,
  Store as StoreIcon,
  ChevronRight,
  RotateCcw,
  TrendingUp,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import type { NebimSalesSelection } from "./nebim-filters";

const TRY = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = (n: number | null | undefined) => `₺${TRY.format(n ?? 0)}`;

function toInput(f: NebimSalesSelection) {
  return {
    store_id: f.storeId || undefined,
    date_from: f.dateFrom || undefined,
    date_to: f.dateTo || undefined,
    only_returns: f.onlyReturns || undefined,
  };
}

export function NebimAnaliz({ filters }: { filters: NebimSalesSelection }) {
  const input = toInput(filters);
  const { data, isLoading } = trpc.nebimSales.analiz.useQuery(input);

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" />
          Analiz hesaplanıyor…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI */}
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Net Toplam" value={fmt(data.kpi.net_total)} />
        <Kpi label="Fiş Sayısı" value={String(data.kpi.invoices)} />
        <Kpi label="Satır Sayısı" value={String(data.kpi.lines)} />
      </div>

      {/* Mağaza */}
      <Section icon={StoreIcon} title="Mağaza Bazında">
        {data.by_store.length === 0 ? (
          <Empty />
        ) : (
          data.by_store.map((s) => (
            <Row
              key={s.store_name ?? "—"}
              left={<span className="font-medium">{s.store_name ?? "(eşleşmeyen)"}</span>}
              sub={`${s.lines} satır`}
              value={fmt(s.net)}
            />
          ))
        )}
      </Section>

      {/* Personel */}
      <Section icon={User} title={`Satış Personeli (${data.by_salesperson.length})`}>
        {data.by_salesperson.length === 0 ? (
          <Empty />
        ) : (
          data.by_salesperson.map((p, i) => (
            <Row
              key={p.name + i}
              left={
                <span className="flex items-center gap-2">
                  <span className="text-[11px] tabular-nums text-muted-foreground w-5">{i + 1}.</span>
                  <User className="h-3.5 w-3.5 text-muted-foreground/70" />
                  <span className="font-medium">{p.name}</span>
                </span>
              }
              sub={`${p.invoices} fiş · ${p.lines} satır`}
              value={fmt(p.net)}
            />
          ))
        )}
      </Section>

      {/* Müşteri — drill-down */}
      <Section
        icon={UserCircle2}
        title={`Müşteriler (${data.by_customer.length})`}
        hint="Satıra tıkla → aldığı ürünler"
      >
        {data.by_customer.length === 0 ? (
          <Empty text="Bu aralıkta isimli müşteri yok. (Geçmiş senkronu eksikse GECMISI-AKTAR çalıştır.)" />
        ) : (
          data.by_customer.map((c, i) => (
            <CustomerRow key={c.name + i} rank={i + 1} customer={c} input={input} />
          ))
        )}
      </Section>
    </div>
  );
}

function CustomerRow({
  rank,
  customer,
  input,
}: {
  rank: number;
  customer: { name: string; net: number; lines: number; invoices: number };
  input: ReturnType<typeof toInput>;
}) {
  const [open, setOpen] = useState(false);
  const products = trpc.nebimSales.customerProducts.useQuery(
    { ...input, customer_name: customer.name },
    { enabled: open }
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-muted/30 transition-colors text-left"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="text-[11px] tabular-nums text-muted-foreground w-5">{rank}.</span>
        <UserCircle2 className="h-4 w-4 text-indigo-600 shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="font-medium text-indigo-700 truncate">{customer.name}</span>
          <span className="block text-[11px] text-muted-foreground">
            {customer.invoices} fiş · {customer.lines} ürün
          </span>
        </span>
        <span className="text-sm font-bold tabular-nums shrink-0">{fmt(customer.net)}</span>
      </button>

      {open ? (
        <div className="bg-muted/20 border-t border-border/40 px-4 py-2">
          {products.isLoading || !products.data ? (
            <div className="py-3 text-center text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 mx-auto animate-spin" />
            </div>
          ) : products.data.items.length === 0 ? (
            <div className="py-2 text-xs text-muted-foreground">Ürün bulunamadı.</div>
          ) : (
            <div className="divide-y divide-border/30">
              {products.data.items.map((it) => (
                <div key={it.id} className="py-1.5 flex items-center gap-3 text-xs">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{it.item_desc ?? it.item_code ?? "—"}</span>
                    {it.is_return ? (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 text-[9px] uppercase font-medium text-rose-600">
                        <RotateCcw className="h-2.5 w-2.5" /> iade
                      </span>
                    ) : null}
                    <span className="block text-[10px] text-muted-foreground">
                      {it.store_name} ·{" "}
                      {new Date(it.invoice_date).toLocaleDateString("tr-TR", { timeZone: "UTC" })}
                      {it.color_desc || it.size
                        ? ` · ${[it.color_desc, it.size].filter(Boolean).join(" / ")}`
                        : ""}
                      {it.salesperson_name ? ` · ${it.salesperson_name}` : ""}
                    </span>
                  </div>
                  <span className="tabular-nums font-semibold shrink-0">{fmt(it.net_amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-xl font-bold tabular-nums mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: typeof User;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Icon className="h-4 w-4" />
          </div>
          <span className="font-semibold text-sm">{title}</span>
          {hint ? (
            <span className="ml-auto text-[11px] text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> {hint}
            </span>
          ) : null}
        </div>
        <div className="divide-y divide-border/40 max-h-[460px] overflow-auto">{children}</div>
      </CardContent>
    </Card>
  );
}

function Row({
  left,
  sub,
  value,
}: {
  left: React.ReactNode;
  sub: string;
  value: string;
}) {
  return (
    <div className="px-4 py-2.5 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div>{left}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </div>
      <span className="text-sm font-bold tabular-nums shrink-0">{value}</span>
    </div>
  );
}

function Empty({ text = "Veri yok." }: { text?: string }) {
  return <div className="px-4 py-6 text-center text-xs text-muted-foreground">{text}</div>;
}
