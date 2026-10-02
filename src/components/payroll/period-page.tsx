"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Banknote,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  HandCoins,
  Lock,
  RefreshCw,
  Unlock,
  Users,
  Wallet,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { PeriodView, ComputedLine, StoreBlock } from "@/server/services/payroll/period";
import { periodLabel, PAY_METHOD_SHORT } from "@/server/services/payroll/rules";
import {
  BATCH_KIND_LABEL,
  BATCH_STATUS_LABEL,
  CHANNEL_SHORT,
  dmy,
  money,
  pct,
  triggerDownload,
} from "./format";
import { LineDialog } from "./line-dialog";
import { BatchDialog, type BatchChoice } from "./batch-dialog";

type Key = { year: number; month: number };

function currentKey(): Key {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
function shift(k: Key, delta: number): Key {
  const m = k.month + delta;
  if (m < 1) return { year: k.year - 1, month: 12 };
  if (m > 12) return { year: k.year + 1, month: 1 };
  return { year: k.year, month: m };
}

export function PayrollPeriodPage() {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const [key, setKey] = useState<Key>(currentKey);
  const [picked, setPicked] = useState(false);
  const periods = trpc.payroll.periods.list.useQuery();

  // İlk açılışta: en ESKİ açık dönem (ay kapatılmadıkça ekran orada kalır,
  // kapatınca sıradaki aya geçer); hiç açık dönem yoksa bu ay.
  useEffect(() => {
    if (picked || !periods.data) return;
    const open = [...periods.data].reverse().find((p) => p.status === "open");
    if (open) setKey({ year: open.year, month: open.month });
    setPicked(true);
  }, [periods.data, picked]);

  const view = trpc.payroll.periods.get.useQuery(key, { enabled: picked });
  const data = view.data ?? null;

  const [openLineId, setOpenLineId] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchChoice | null>(null);

  const invalidate = () => {
    void utils.payroll.periods.get.invalidate(key);
    void utils.payroll.periods.list.invalidate();
    void utils.payroll.cashAdvances.suggest.invalidate();
  };

  const openPeriod = trpc.payroll.periods.open.useMutation({
    onSuccess: () => {
      toast.success(`${periodLabel(key.year, key.month)} dönemi açıldı`);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const closePeriod = trpc.payroll.periods.close.useMutation({
    onSuccess: () => {
      toast.success("Ay kapatıldı");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const reopenPeriod = trpc.payroll.periods.reopen.useMutation({
    onSuccess: () => {
      toast.success("Ay yeniden açıldı");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const ensure = trpc.payroll.periods.ensureLines.useMutation({
    onSuccess: (r) => {
      toast.success(r.added > 0 ? `${r.added} yeni satır eklendi` : "Eksik satır yok");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const nebim = trpc.payroll.storeMonth.fillFromNebim.useMutation({
    onSuccess: (r) => {
      toast.success(
        `Nebim'den dolduruldu — ${r.filledStores.length} mağaza, ${r.filledPeople.length} kişi${
          r.unmatched.length ? ` · eşleşmeyen: ${r.unmatched.join("; ")}` : ""
        }`,
        { duration: 9000 }
      );
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const openLine: ComputedLine | null = useMemo(() => {
    if (!data || !openLineId) return null;
    for (const s of data.stores) {
      const l = s.lines.find((x) => x.id === openLineId);
      if (l) return l;
    }
    return null;
  }, [data, openLineId]);
  const openStore: StoreBlock | null = useMemo(
    () => (data && openLine ? data.stores.find((s) => s.store_id === openLine.store_id) ?? null : null),
    [data, openLine]
  );

  const label = periodLabel(key.year, key.month);
  const isClosed = data?.period.status === "closed";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Maaşlar"
          description="7 mağazanın bordrosu: baz maaş, mesai, komisyon, primler, avans ve kesintiler — Ödeme 1 ve Ödeme 2 talimatları buradan hazırlanır."
        />
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/payroll/employees">
              <Users className="h-4 w-4 mr-2" />
              Personel
            </Link>
          </Button>
        </div>
      </div>

      {/* Dönem seçici */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center rounded-xl border bg-card shadow-xs">
          <button
            type="button"
            className="px-3 py-2 hover:bg-accent rounded-l-xl"
            onClick={() => setKey((k) => shift(k, -1))}
            aria-label="Önceki ay"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="px-4 py-2 min-w-[11rem] text-center font-semibold tracking-tight">{label}</div>
          <button
            type="button"
            className="px-3 py-2 hover:bg-accent rounded-r-xl"
            onClick={() => setKey((k) => shift(k, 1))}
            aria-label="Sonraki ay"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {data ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1",
              isClosed
                ? "bg-slate-100 text-slate-700 ring-slate-200"
                : "bg-emerald-50 text-emerald-700 ring-emerald-200/70"
            )}
          >
            {isClosed ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
            {isClosed ? "Kapalı ay" : "Açık ay"}
          </span>
        ) : null}
        {periods.data && periods.data.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {periods.data.slice(0, 8).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setKey({ year: p.year, month: p.month })}
                className={cn(
                  "rounded-full px-2.5 py-1 ring-1 transition-colors",
                  p.year === key.year && p.month === key.month
                    ? "bg-primary/10 text-primary ring-primary/30"
                    : "bg-card text-muted-foreground ring-border hover:text-foreground"
                )}
              >
                {p.label}
                {p.status === "closed" ? " ·🔒" : ""}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {view.isLoading && picked ? (
        <div className="text-sm text-muted-foreground">Yükleniyor…</div>
      ) : !data ? (
        <div className="rounded-2xl border border-dashed bg-card p-10 text-center space-y-3">
          <Banknote className="mx-auto h-8 w-8 text-muted-foreground" />
          <div className="font-medium">{label} dönemi henüz açılmadı</div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Dönemi açınca aktif personelin tamamı için satırlar oluşturulur; baz maaşlar personel
            kartından kopyalanır.
          </p>
          <Button onClick={() => openPeriod.mutate(key)} disabled={openPeriod.isPending}>
            {label} dönemini aç
          </Button>
        </div>
      ) : (
        <>
          <Kpis data={data} />

          {/* İşlemler */}
          <div className="grid gap-4 lg:grid-cols-3">
            <ActionCard
              icon={<Wallet className="h-4 w-4" />}
              title="Avans"
              description="Ay ortası avans talimatı ve nakit avans listesi."
              buttons={[
                { label: "Garanti talimatı", onClick: () => setBatch({ kind: "advance", channel: "garanti" }) },
                { label: "Nakit listesi", onClick: () => setBatch({ kind: "advance", channel: "cash" }) },
              ]}
              disabled={isClosed}
            />
            <ActionCard
              icon={<Banknote className="h-4 w-4" />}
              title="Ödeme 1 — baz maaş"
              description="Avans ve kesintiler düşülmüş kalan maaş; ayın 1–3'ünde."
              buttons={[
                { label: "Garanti talimatı", onClick: () => setBatch({ kind: "payment1", channel: "garanti" }) },
                { label: "Ziraat", onClick: () => setBatch({ kind: "payment1", channel: "ziraat" }) },
                { label: "Nakit", onClick: () => setBatch({ kind: "payment1", channel: "cash" }) },
              ]}
              disabled={isClosed}
            />
            <ActionCard
              icon={<HandCoins className="h-4 w-4" />}
              title="Ödeme 2 — mesai + komisyon + prim"
              description="Performans verisi girildikten sonra kalan hak ediş."
              buttons={[
                { label: "Garanti talimatı", onClick: () => setBatch({ kind: "payment2", channel: "garanti" }) },
                { label: "Ziraat", onClick: () => setBatch({ kind: "payment2", channel: "ziraat" }) },
                { label: "Nakit", onClick: () => setBatch({ kind: "payment2", channel: "cash" }) },
              ]}
              disabled={isClosed}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => nebim.mutate({ period_id: data.period.id })}
              disabled={nebim.isPending || isClosed}
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", nebim.isPending && "animate-spin")} />
              Derimod cirolarını Nebim&apos;den al
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => ensure.mutate({ period_id: data.period.id })}
              disabled={ensure.isPending || isClosed}
            >
              <Users className="h-4 w-4 mr-2" />
              Eksik personel satırlarını ekle
            </Button>
            <div className="flex-1" />
            {isClosed ? (
              <Button variant="outline" size="sm" onClick={() => reopenPeriod.mutate({ period_id: data.period.id })}>
                <Unlock className="h-4 w-4 mr-2" />
                Ayı yeniden aç
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const ok = await confirm({
                    title: `${label} kapatılsın mı?`,
                    description:
                      "Ay yalnız herkesin Net Kalan'ı sıfırken kapanır. Kapalı ayda kayıt değişmez; gerekirse yeniden açılır.",
                    confirmLabel: "Kapat",
                  });
                  if (ok) closePeriod.mutate({ period_id: data.period.id });
                }}
                disabled={closePeriod.isPending}
              >
                <Lock className="h-4 w-4 mr-2" />
                Ayı kapat
              </Button>
            )}
          </div>

          <Alerts data={data} onOpen={setOpenLineId} />
          <CashAdvanceSuggestions periodId={data.period.id} onDone={invalidate} />

          {data.stores.map((s) => (
            <StoreCard
              key={s.store_id}
              store={s}
              periodId={data.period.id}
              closed={isClosed}
              onOpen={setOpenLineId}
              onSaved={invalidate}
            />
          ))}

          <Batches data={data} onChanged={invalidate} />
        </>
      )}

      {openLine && openStore && data ? (
        <LineDialog
          line={openLine}
          store={openStore}
          periodStatus={data.period.status}
          onClose={() => setOpenLineId(null)}
          onChanged={invalidate}
        />
      ) : null}
      {batch && data ? (
        <BatchDialog
          periodId={data.period.id}
          periodLabel={data.period.label}
          choice={batch}
          onClose={() => setBatch(null)}
          onCreated={invalidate}
        />
      ) : null}
    </div>
  );
}

function Kpis({ data }: { data: PeriodView }) {
  const t = data.totals;
  const items = [
    { label: "Toplam hak ediş", value: money(t.gross), hint: `${t.people} kişi · baz ${money(t.base, { cents: false })}` },
    { label: "Ödenen", value: money(t.paid), hint: `avans ${money(t.advances, { cents: false })} · ödeme ${money(t.payments, { cents: false })}` },
    {
      label: "Maaşlar (Ödeme 1)",
      value: `${t.base_paid_count} / ${t.base_lines}`,
      hint: t.base_paid_count === t.base_lines ? "tüm baz maaşlar ödendi" : `${t.base_lines - t.base_paid_count} kişinin maaşı ödenmedi`,
      tone: t.base_paid_count === t.base_lines ? "text-emerald-700" : "text-amber-700",
    },
    {
      label: "Net kalan",
      value: money(t.remaining),
      hint: `${t.open} kişi açık · ekstra bekleyen ${money(t.extras_pending, { cents: false })}`,
      tone: t.remaining > 0.5 ? "text-amber-700" : "text-emerald-700",
    },
    { label: "Mesai + komisyon + prim", value: money(t.overtime + t.commission + t.premiums), hint: `kesinti ${money(t.deductions, { cents: false })}` },
    { label: "Uyarı", value: String(t.warnings), hint: t.warnings ? "kontrol edilmeli" : "temiz", tone: t.warnings ? "text-rose-700" : "text-emerald-700" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {items.map((it) => (
        <div key={it.label} className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{it.label}</div>
          <div className={cn("mt-1 text-xl font-semibold tabular-nums tracking-tight", it.tone)}>{it.value}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{it.hint}</div>
        </div>
      ))}
    </div>
  );
}

function ActionCard({
  icon,
  title,
  description,
  buttons,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  buttons: Array<{ label: string; onClick: () => void }>;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-center gap-2 font-medium">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        {title}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {buttons.map((b) => (
          <Button key={b.label} size="sm" variant="secondary" onClick={b.onClick} disabled={disabled}>
            <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
            {b.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Alerts({ data, onOpen }: { data: PeriodView; onOpen: (id: string) => void }) {
  if (data.alerts.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-200/70 bg-amber-50/40 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
        <AlertTriangle className="h-4 w-4" />
        Kontrol edilmesi gerekenler ({data.alerts.length})
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {data.alerts.map((a, i) => (
          <li key={`${a.line_id}-${i}`}>
            <button
              type="button"
              onClick={() => onOpen(a.line_id)}
              className="text-left hover:underline"
            >
              <span className={cn("font-medium", a.level === "error" ? "text-rose-700" : "text-amber-800")}>
                {a.full_name}
              </span>{" "}
              <span className="text-muted-foreground">({a.store_name})</span> — {a.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CashAdvanceSuggestions({ periodId, onDone }: { periodId: string; onDone: () => void }) {
  const q = trpc.payroll.cashAdvances.suggest.useQuery({ period_id: periodId });
  const link = trpc.payroll.cashAdvances.link.useMutation({
    onSuccess: () => {
      toast.success("Kasa avansı bordroya işlendi");
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });
  const rows = q.data ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="text-sm font-medium">Kasadan verilen avanslar — bordroya aktarılmamış ({rows.length})</div>
      <p className="text-xs text-muted-foreground mt-0.5">
        Mağazaların günlük kayıtlarında &quot;avans&quot; olarak girilen nakitler. Aktarınca kişinin ayından düşer.
      </p>
      <ul className="mt-3 divide-y text-sm">
        {rows.map((r) => (
          <li key={r.cash_advance_id} className="flex flex-wrap items-center gap-3 py-2">
            <span className="w-24 tabular-nums text-muted-foreground">{dmy(r.date)}</span>
            <span className="font-medium">{r.staff_name}</span>
            <span className="text-muted-foreground">{r.store_name}</span>
            <span className="tabular-nums font-medium">{money(r.amount)} ₺</span>
            <span className="flex-1 text-xs text-muted-foreground truncate">{r.description}</span>
            {r.line_id ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => link.mutate({ line_id: r.line_id!, cash_advance_id: r.cash_advance_id })}
                disabled={link.isPending}
              >
                {r.matched_name && r.matched_name !== r.staff_name ? `${r.matched_name} olarak aktar` : "Aktar"}
              </Button>
            ) : (
              <span className="text-xs text-rose-700">Personelde eşleşme yok — takma ad ekle</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StoreCard({
  store,
  periodId,
  closed,
  onOpen,
  onSaved,
}: {
  store: StoreBlock;
  periodId: string;
  closed: boolean;
  onOpen: (id: string) => void;
  onSaved: () => void;
}) {
  const [revenue, setRevenue] = useState<number | undefined>(store.revenue ?? undefined);
  const [target, setTarget] = useState<number | undefined>(store.target ?? undefined);
  useEffect(() => {
    setRevenue(store.revenue ?? undefined);
    setTarget(store.target ?? undefined);
  }, [store.revenue, store.target]);
  const upsert = trpc.payroll.storeMonth.upsert.useMutation({
    onSuccess: () => {
      toast.success(`${store.store_name}: mağaza cirosu/hedefi kaydedildi`);
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });
  const dirty = (revenue ?? null) !== (store.revenue ?? null) || (target ?? null) !== (store.target ?? null);
  const ach = revenue && target ? revenue / target : null;

  return (
    <section className="rounded-2xl border bg-card shadow-xs overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/30 px-4 py-3">
        <div className="min-w-[12rem]">
          <div className="font-semibold tracking-tight">{store.store_name}</div>
          <div className="text-xs text-muted-foreground">
            {store.brand_name} · {store.lines.length} kişi
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground">
            Mağaza cirosu
            <MoneyInput
              value={revenue}
              onChange={setRevenue}
              placeholder="SAP / Nebim net"
              className="mt-0.5 h-8 w-40 text-sm"
              disabled={closed}
            />
          </label>
          <label className="text-xs text-muted-foreground" title="Genel merkezin (Mavi / Derimod HQ) mağazaya verdiği aylık satış hedefi — müdür komisyonu buna göre">
            Merkez hedefi (aylık)
            <MoneyInput
              value={target}
              onChange={setTarget}
              placeholder="merkezin hedefi"
              className="mt-0.5 h-8 w-36 text-sm"
              disabled={closed}
            />
          </label>
          <div className="pb-1.5 text-sm tabular-nums min-w-[5rem]">
            {ach != null ? (
              <span className={cn("font-medium", ach >= 1 ? "text-emerald-700" : ach >= 0.95 ? "text-amber-700" : "text-rose-700")}>
                {pct(ach)}
              </span>
            ) : (
              <span className="text-muted-foreground">başarı —</span>
            )}
          </div>
          {dirty ? (
            <Button
              size="sm"
              className="h-8"
              onClick={() =>
                upsert.mutate({ period_id: periodId, store_id: store.store_id, revenue: revenue ?? null, target: target ?? null })
              }
              disabled={upsert.isPending || closed}
            >
              Kaydet
            </Button>
          ) : null}
          {store.revenue_source === "nebim" ? (
            <span className="pb-1.5 text-[11px] text-muted-foreground">ciro: Nebim</span>
          ) : null}
        </div>
        <div className="ml-auto grid grid-cols-4 gap-4 text-right text-xs">
          <Tot label="Baz" v={store.totals.base} />
          <Tot label="Hak ediş" v={store.totals.gross} />
          <Tot label="Ödenen" v={store.totals.paid} />
          <Tot label="Kalan" v={store.totals.remaining} tone={store.totals.remaining > 0.5 ? "text-amber-700" : "text-emerald-700"} />
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-2 text-left font-medium">Çalışan</th>
              <th className="px-3 py-2 text-right font-medium">Baz</th>
              <th className="px-3 py-2 text-right font-medium">Mesai</th>
              <th className="px-3 py-2 text-right font-medium">Komisyon</th>
              <th className="px-3 py-2 text-right font-medium">Primler</th>
              <th className="px-3 py-2 text-right font-medium">Kesinti</th>
              <th className="px-3 py-2 text-right font-medium">Hak ediş</th>
              <th className="px-3 py-2 text-right font-medium">Avans</th>
              <th className="px-3 py-2 text-right font-medium">Ödenen</th>
              <th className="px-3 py-2 text-right font-medium">Net kalan</th>
            </tr>
          </thead>
          <tbody>
            {store.lines.map((l) => (
              <LineRow key={l.id} line={l} onOpen={onOpen} />
            ))}
            {store.lines.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-muted-foreground">
                  Bu mağazada bordro satırı yok.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Tot({ label, v, tone }: { label: string; v: number; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("font-medium tabular-nums", tone)}>{money(v, { cents: false })}</div>
    </div>
  );
}

function LineRow({ line, onOpen }: { line: ComputedLine; onOpen: (id: string) => void }) {
  const c = line.calc;
  const warn = c.flags.filter((f) => f.level !== "info");
  const premiums = c.perfume_amount + c.garment_amount + c.top_seller_amount + c.extra_premium + c.additions_total;
  const closed = Math.abs(c.net_remaining) <= 0.5;
  return (
    <tr
      className={cn(
        "border-b last:border-0 cursor-pointer transition-colors hover:bg-accent/40",
        line.employee_status !== "active" && "opacity-70"
      )}
      onClick={() => onOpen(line.id)}
    >
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div>
            <div className="font-medium leading-tight">{line.full_name}</div>
            <div className="text-[11px] text-muted-foreground">
              {line.position} · {PAY_METHOD_SHORT[line.pay_method]}
              {line.employee_status === "left" ? " · ayrıldı" : line.employee_status === "inactive" ? " · pasif" : ""}
              {line.paid_month_early ? " · bir ay önceden" : ""}
            </div>
          </div>
          {warn.length > 0 ? (
            <span title={warn.map((w) => w.text).join("\n")}>
              <AlertTriangle className={cn("h-4 w-4", warn.some((w) => w.level === "error") ? "text-rose-600" : "text-amber-600")} />
            </span>
          ) : null}
          {c.commission.special ? (
            <span className="rounded px-1 text-[10px] font-semibold bg-violet-50 text-violet-700 ring-1 ring-violet-200/70">ÖZEL</span>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{money(line.base_salary)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {c.overtime_amount > 0 ? (
          <>
            {money(c.overtime_amount)}
            <div className="text-[10px] text-muted-foreground">{line.overtime_hours} saat</div>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {line.commission_profile === "none" ? (
          <span className="text-muted-foreground">—</span>
        ) : c.commission.final > 0 ? (
          <>
            {money(c.commission.final)}
            <div className="text-[10px] text-muted-foreground">
              {c.commission.achievement_used != null ? pct(c.commission.achievement_used) : "hedef?"}
            </div>
          </>
        ) : (
          <span className="text-muted-foreground">bekliyor</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{premiums > 0 ? money(premiums) : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-rose-700">{c.deductions_total > 0 ? `−${money(c.deductions_total)}` : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-3 py-2.5 text-right tabular-nums font-medium">{money(c.gross)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-amber-800">{c.advances_total > 0 ? money(c.advances_total) : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{money(c.paid_total)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        <span
          className={cn(
            "inline-block rounded-md px-2 py-0.5 font-medium",
            closed
              ? "bg-emerald-50 text-emerald-700"
              : c.net_remaining < 0
                ? "bg-rose-50 text-rose-700"
                : "bg-amber-50 text-amber-800"
          )}
        >
          {closed ? "0,00 ✓" : money(c.net_remaining)}
        </span>
        {!closed ? (
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {c.base_paid ? "maaş ödendi · ekstra bekliyor" : `maaş eksik ${money(c.payment1_due, { cents: false })}`}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function Batches({ data, onChanged }: { data: PeriodView; onChanged: () => void }) {
  const confirm = useConfirm();
  const download = trpc.payroll.batches.download.useMutation({
    onSuccess: (r) => triggerDownload(r.file_base64, r.file_name),
    onError: (e) => toast.error(e.message),
  });
  const setStatus = trpc.payroll.batches.setStatus.useMutation({
    onSuccess: () => {
      toast.success("Talimat güncellendi");
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  if (data.batches.length === 0) return null;
  return (
    <section className="rounded-2xl border bg-card shadow-xs">
      <header className="border-b px-4 py-3 font-semibold tracking-tight">Talimatlar ve listeler</header>
      <ul className="divide-y text-sm">
        {data.batches.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                b.status === "sent"
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200/70"
                  : b.status === "void"
                    ? "bg-slate-100 text-slate-600 ring-slate-200 line-through"
                    : "bg-amber-50 text-amber-800 ring-amber-200/70"
              )}
            >
              {BATCH_STATUS_LABEL[b.status]}
            </span>
            <span className="font-medium">{BATCH_KIND_LABEL[b.kind]}</span>
            <span className="text-muted-foreground">
              {CHANNEL_SHORT[b.channel]} · {dmy(b.pay_date)} · {b.count} kişi
            </span>
            <span className="tabular-nums font-medium">{money(b.total)} ₺</span>
            <span className="flex-1 truncate text-xs text-muted-foreground">{b.file_name}</span>
            <Button size="sm" variant="outline" onClick={() => download.mutate({ id: b.id })} disabled={download.isPending}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              İndir
            </Button>
            {b.status === "prepared" ? (
              <Button size="sm" onClick={() => setStatus.mutate({ id: b.id, status: "sent" })} disabled={setStatus.isPending}>
                Gönderildi / ödendi
              </Button>
            ) : null}
            {b.status !== "void" ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-rose-700"
                onClick={async () => {
                  const ok = await confirm({
                    title: "Talimat iptal edilsin mi?",
                    description: "Bu talimatın tüm ödeme kayıtları iptal edilir (silinmez, üstü çizilir).",
                    confirmLabel: "İptal et",
                    destructive: true,
                  });
                  if (ok) setStatus.mutate({ id: b.id, status: "void", note: "Talimat iptal edildi" });
                }}
              >
                İptal
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Küçük yardımcı: sayısal giriş (saat/adet) — MoneyInput değil.
export function NumInput(props: React.ComponentPropsWithoutRef<typeof Input>) {
  return <Input type="number" inputMode="decimal" {...props} />;
}
