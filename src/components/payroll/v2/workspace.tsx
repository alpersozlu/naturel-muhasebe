"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Banknote, Check, ChevronDown, ChevronLeft, ChevronRight, Lock, MoreHorizontal, RefreshCw, Table2, Unlock, UserPlus, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { PeriodView } from "@/server/services/payroll/period";
import { periodLabel } from "@/server/services/payroll/rules";
import { BatchDialog, type BatchChoice } from "../batch-dialog";
import { money, nextMonthOf } from "../format";
import { NewStarterDialog } from "../new-starter-dialog";
import { FullTable } from "./full-table";
import { Chip } from "./parts";
import { PersonSheet } from "./person-sheet";
import { StepAdvance } from "./step-advance";
import { StepClose } from "./step-close";
import { StepExtras } from "./step-extras";
import { StepSalary } from "./step-salary";

type Key = { year: number; month: number };
export type Step = "avans" | "maas" | "prim" | "kapanis" | "tablo";

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

/** Ayın geldiği yer: ilk bitmemiş adım. */
function currentStep(d: PeriodView): Step {
  const t = d.totals;
  if (d.period.status === "closed") return "kapanis";
  if (t.base_lines > 0 && t.base_paid_count < t.base_lines) return t.advances > 0.005 ? "maas" : "avans";
  if (t.open > 0) return "prim";
  return "kapanis";
}

/**
 * MAAŞLAR — ayın işi dört adımdır ve sayfa bu sırayla kuruludur:
 *   1 Avans → 2 Maaş (Ödeme 1) → 3 Prim (Ödeme 2) → 4 Kapanış
 *
 * Her adım yalnız kendi işini gösterir; sayfa ayın geldiği adımda açılır.
 * Bir kişiye ait her şey (giriş, kesinti, ödeme kaydı) sağdan açılan tek
 * panelde toplanır. Hesap motoru, talimat pencereleri ve belge okuma eski
 * düzenle aynıdır — değişen yalnız kurgu ve görünümdür.
 */
export function PayrollWorkspace() {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const [key, setKey] = useState<Key>(currentKey);
  const [picked, setPicked] = useState(false);
  const periods = trpc.payroll.periods.list.useQuery();

  // İlk açılışta en ESKİ açık dönem: ay kapatılmadıkça ekran orada kalır.
  useEffect(() => {
    if (picked || !periods.data) return;
    const open = [...periods.data].reverse().find((p) => p.status === "open");
    if (open) setKey({ year: open.year, month: open.month });
    setPicked(true);
  }, [periods.data, picked]);

  const view = trpc.payroll.periods.get.useQuery(key, { enabled: picked });
  const data = view.data ?? null;
  const kolay = trpc.payroll.kolayik.month.useQuery(key, { enabled: !!data, staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false });

  const [step, setStep] = useState<Step>("avans");
  const steppedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!data || steppedFor.current === data.period.id) return;
    steppedFor.current = data.period.id;
    setStep(currentStep(data));
  }, [data]);

  const [openLineId, setOpenLineId] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchChoice | null>(null);
  const [starter, setStarter] = useState(false);

  const invalidate = () => {
    void utils.payroll.periods.get.invalidate(key);
    void utils.payroll.periods.list.invalidate();
    void utils.payroll.cashAdvances.suggest.invalidate();
  };

  const label = periodLabel(key.year, key.month);
  const openPeriod = trpc.payroll.periods.open.useMutation({
    onSuccess: () => (toast.success(`${label} dönemi açıldı`), invalidate()),
    onError: (e) => toast.error(e.message),
  });
  const closePeriod = trpc.payroll.periods.close.useMutation({
    onSuccess: () => (toast.success("Ay kapatıldı"), invalidate()),
    onError: (e) => toast.error(e.message),
  });
  const reopenPeriod = trpc.payroll.periods.reopen.useMutation({
    onSuccess: () => (toast.success("Ay yeniden açıldı"), invalidate()),
    onError: (e) => toast.error(e.message),
  });
  const ensure = trpc.payroll.periods.ensureLines.useMutation({
    onSuccess: (r) => (toast.success(r.added > 0 ? `${r.added} yeni satır eklendi` : "Eksik satır yok"), invalidate()),
    onError: (e) => toast.error(e.message),
  });
  const nebim = trpc.payroll.storeMonth.fillFromNebim.useMutation({
    onSuccess: (r) => {
      toast.success(`Nebim’den dolduruldu: ${r.filledStores.length} mağaza, ${r.filledPeople.length} kişi${r.unmatched.length ? ` · eşleşmeyen: ${r.unmatched.join("; ")}` : ""}`, { duration: 9000 });
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const isClosed = data?.period.status === "closed";
  // Panelde yukarı / aşağı gezinme sırası: ekrandaki mağaza ve kişi sırası.
  const order = useMemo(() => (data ? data.stores.flatMap((s) => s.lines.map((l) => l.id)) : []), [data]);
  const openLine = useMemo(() => (data && openLineId ? (data.stores.flatMap((s) => s.lines).find((l) => l.id === openLineId) ?? null) : null), [data, openLineId]);
  const openStore = data && openLine ? (data.stores.find((s) => s.store_id === openLine.store_id) ?? null) : null;
  const idx = openLineId ? order.indexOf(openLineId) : -1;
  const next = data ? nextMonthOf(data.period.year, data.period.month) : null;

  const askClose = async () => {
    if (!data) return;
    const ok = await confirm({
      title: `${label} kapatılsın mı?`,
      description: "Kapalı ayda kayıt değişmez; gerekirse yeniden açılır.",
      confirmLabel: "Kapat",
    });
    if (ok) closePeriod.mutate({ period_id: data.period.id });
  };

  return (
    <div className="space-y-6">
      {/* Başlık: ay + nadir işlemler */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Maaşlar</h1>
        <div className="inline-flex items-center rounded-xl border bg-card shadow-xs">
          <button type="button" className="rounded-l-xl px-2.5 py-2 hover:bg-accent" onClick={() => setKey((k) => shift(k, -1))} aria-label="Önceki ay">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex min-w-[10rem] items-center justify-center gap-1.5 px-2 py-2 font-semibold tracking-tight hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
              {label}
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="min-w-[12rem]">
              <DropdownMenuLabel>Dönemler</DropdownMenuLabel>
              {(periods.data ?? []).slice(0, 12).map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => setKey({ year: p.year, month: p.month })} className={cn(p.year === key.year && p.month === key.month && "font-semibold text-primary")}>
                  {p.label}
                  <span className="ml-auto pl-4 text-sm text-muted-foreground">{p.status === "closed" ? "kapalı" : "açık"}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" className="rounded-r-xl px-2.5 py-2 hover:bg-accent" onClick={() => setKey((k) => shift(k, 1))} aria-label="Sonraki ay">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {data ? (
          <Chip tone={isClosed ? "muted" : "ok"}>
            {isClosed ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
            {isClosed ? "Kapalı ay" : "Açık ay"}
          </Chip>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/payroll/employees">
              <Users className="mr-2 h-4 w-4" />
              Personel
            </Link>
          </Button>
          {data ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Diğer işlemler">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[17rem]">
                <DropdownMenuItem disabled={isClosed} onSelect={() => setStarter(true)}>
                  <UserPlus />
                  Yeni başlayan ekle
                </DropdownMenuItem>
                <DropdownMenuItem disabled={isClosed || ensure.isPending} onSelect={() => ensure.mutate({ period_id: data.period.id })}>
                  <Users />
                  Eksik personel satırlarını ekle
                </DropdownMenuItem>
                <DropdownMenuItem disabled={isClosed || nebim.isPending} onSelect={() => nebim.mutate({ period_id: data.period.id })}>
                  <RefreshCw />
                  Derimod cirolarını Nebim’den al
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/payroll/eski">Eski görünümü aç</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {periods.isError || view.isError ? (
        // Sunucuya ulaşılamadığında "dönem açılmadı" DENMEZ: dönem yerinde durur,
        // yalnız okunamamıştır (03.10.2026 kesintisinde Ekim "açılmadı" göründü).
        <Empty icon={<AlertTriangle className="mx-auto h-8 w-8 text-rose-600" />} title="Bordro verisi alınamadı" text="Sunucu yanıt vermedi. Dönemler ve kayıtlar yerinde duruyor; birazdan yeniden deneyin.">
          <Button
            variant="outline"
            onClick={() => {
              void periods.refetch();
              if (picked) void view.refetch();
            }}
          >
            Yeniden dene
          </Button>
        </Empty>
      ) : !picked || view.isLoading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Yükleniyor">
          <div className="h-24 animate-pulse rounded-2xl bg-muted/60" />
          <div className="h-20 animate-pulse rounded-2xl bg-muted/60" />
          <div className="h-72 animate-pulse rounded-2xl bg-muted/60" />
        </div>
      ) : !data ? (
        <Empty icon={<Banknote className="mx-auto h-8 w-8 text-muted-foreground" />} title={`${label} dönemi henüz açılmadı`} text="Dönemi açınca aktif personelin tamamı için satırlar oluşturulur; baz maaşlar personel kartından kopyalanır.">
          <Button onClick={() => openPeriod.mutate(key)} disabled={openPeriod.isPending}>
            {label} dönemini aç
          </Button>
        </Empty>
      ) : (
        <>
          <Summary data={data} />
          <Stepper data={data} step={step} onStep={setStep} />

          {step === "avans" ? (
            <StepAdvance data={data} closed={!!isClosed} onBatch={setBatch} onOpenLine={setOpenLineId} onChanged={invalidate} />
          ) : step === "maas" ? (
            <StepSalary data={data} closed={!!isClosed} onBatch={setBatch} onOpenLine={setOpenLineId} onChanged={invalidate} />
          ) : step === "prim" ? (
            <StepExtras
              data={data}
              closed={!!isClosed}
              kolay={{ data: kolay.data, loading: kolay.isFetching, error: kolay.error?.message ?? null, refetch: () => void kolay.refetch() }}
              onOpenLine={setOpenLineId}
              onBatch={setBatch}
              onChanged={invalidate}
            />
          ) : step === "kapanis" ? (
            <StepClose
              data={data}
              busy={closePeriod.isPending || reopenPeriod.isPending}
              onOpenLine={setOpenLineId}
              onChanged={invalidate}
              onClosePeriod={askClose}
              onReopenPeriod={() => reopenPeriod.mutate({ period_id: data.period.id })}
            />
          ) : (
            <FullTable data={data} onOpenLine={setOpenLineId} />
          )}
        </>
      )}

      {openLine && openStore && data && next ? (
        <PersonSheet
          line={openLine}
          store={openStore}
          period={data.period}
          closed={!!isClosed}
          nextLabel={periodLabel(next.year, next.month)}
          overtime={(kolay.data?.overtime ?? []).find((o) => o.line_id === openLine.id)}
          onPrev={idx > 0 ? () => setOpenLineId(order[idx - 1]!) : undefined}
          onNext={idx >= 0 && idx < order.length - 1 ? () => setOpenLineId(order[idx + 1]!) : undefined}
          onClose={() => setOpenLineId(null)}
          onChanged={invalidate}
        />
      ) : null}
      {batch && data ? <BatchDialog periodId={data.period.id} periodLabel={data.period.label} choice={batch} onClose={() => setBatch(null)} onCreated={invalidate} /> : null}
      {starter && data ? <NewStarterDialog period={data.period} onClose={() => setStarter(false)} onCreated={invalidate} /> : null}
    </div>
  );
}

function Empty({ icon, title, text, children }: { icon: React.ReactNode; title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-2xl border border-dashed bg-card p-12 text-center">
      {icon}
      <div className="font-medium">{title}</div>
      <p className="mx-auto max-w-md text-sm text-muted-foreground">{text}</p>
      {children}
    </div>
  );
}

/** Ayın üç rakamı ve ödeme ilerlemesi — tek satır. */
export function Summary({ data }: { data: PeriodView }) {
  const t = data.totals;
  const salaryPaid = Math.round((t.payments - t.p2_paid) * 100) / 100;
  const share = t.gross > 0 ? Math.max(0, Math.min(1, t.paid / t.gross)) : 0;
  const done = Math.abs(t.remaining) <= 0.5 && t.open === 0;
  // Sonraki aya devredilen tutar hak ediş değildir ama bu ayın bakiyesini kapatır:
  // yazılmazsa "ödenen, hak edişten fazla" görünür.
  const lines = data.stores.flatMap((s) => s.lines);
  const carried = Math.round(lines.reduce((x, l) => x + l.calc.carried_forward_total, 0) * 100) / 100;
  const refunded = Math.round(lines.reduce((x, l) => x + l.calc.refund_received_total, 0) * 100) / 100;
  return (
    <section className="rounded-2xl border bg-card shadow-xs" aria-label="Ay özeti">
      <dl className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="px-5 py-4">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Toplam hak ediş</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{money(t.gross)}</dd>
          <dd className="mt-0.5 text-sm text-muted-foreground">
            {t.people} kişi · baz {money(t.base)}
          </dd>
        </div>
        <div className="px-5 py-4">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ödenen</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{money(t.paid)}</dd>
          <dd className="mt-0.5 text-sm text-muted-foreground">
            avans {money(t.advances)} · maaş {money(salaryPaid)} · prim {money(t.p2_paid)}
          </dd>
        </div>
        <div className="px-5 py-4">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kalan</dt>
          <dd className={cn("mt-1 text-2xl font-semibold tabular-nums tracking-tight", done ? "text-emerald-700" : "text-amber-800")}>{money(t.remaining)}</dd>
          <dd className="mt-0.5 text-sm text-muted-foreground">
            {done ? "herkes kapandı" : `${t.open} kişi açık`}
            {carried > 0.005 ? ` · ${money(carried)} sonraki aya devredildi` : ""}
            {refunded > 0.005 ? ` · ${money(refunded)} iade alındı` : ""}
          </dd>
        </div>
      </dl>
      <div className="h-1.5 overflow-hidden rounded-b-2xl bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="Ödenen oran">
        <div className={cn("h-full transition-[width] duration-500", done ? "bg-emerald-500" : "bg-primary")} style={{ width: `${share * 100}%` }} />
      </div>
    </section>
  );
}

/** Dört adım: numara, ad, tek satır durum. Bitmiş adımda onay işareti. */
export function Stepper({ data, step, onStep }: { data: PeriodView; step: Step; onStep: (s: Step) => void }) {
  const t = data.totals;
  const closed = data.period.status === "closed";
  const items: Array<{ key: Step; n: number; title: string; status: string; done: boolean; warn?: boolean }> = [
    { key: "avans", n: 1, title: "Avans", status: t.advances > 0.005 ? `${money(t.advances)} ₺ verildi` : "henüz verilmedi", done: t.advances > 0.005 },
    {
      key: "maas",
      n: 2,
      title: "Maaş",
      status: t.base_lines === 0 ? "satır yok" : `${t.base_paid_count} / ${t.base_lines} kişi ödendi`,
      done: t.base_lines > 0 && t.base_paid_count === t.base_lines,
    },
    {
      key: "prim",
      n: 3,
      title: "Prim",
      status: t.p2_lines === 0 ? "henüz hesaplanmadı" : t.p2_due > 0.5 ? `${t.p2_settled_count} / ${t.p2_lines} ödendi · ${money(t.p2_due)} ₺ bekliyor` : `${t.p2_settled_count} / ${t.p2_lines} kişi ödendi`,
      done: t.p2_lines > 0 && t.p2_settled_count === t.p2_lines && t.p2_due <= 0.5,
    },
    {
      key: "kapanis",
      n: 4,
      title: "Kapanış",
      status: closed ? "ay kapalı" : t.open > 0 ? `${t.open} kişi açık${t.warnings ? ` · ${t.warnings} uyarı` : ""}` : t.warnings ? `${t.warnings} uyarı` : "kapatılabilir",
      done: closed,
      warn: !closed && t.warnings > 0,
    },
  ];
  return (
    <nav className="grid gap-2 lg:grid-cols-[1fr_auto]" aria-label="Ayın adımları">
      <ol className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4">
        {items.map((it) => {
          const active = step === it.key;
          return (
            <li key={it.key}>
              <button
                type="button"
                onClick={() => onStep(it.key)}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex h-full w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  active ? "border-primary bg-primary/5 shadow-xs" : "bg-card hover:border-primary/40 hover:bg-accent/40"
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                    it.done ? "bg-emerald-100 text-emerald-800" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  )}
                >
                  {it.done ? <Check className="h-4 w-4" /> : it.n}
                </span>
                <span className="min-w-0">
                  <span className={cn("block font-semibold tracking-tight", active && "text-primary")}>{it.title}</span>
                  <span className={cn("block text-sm leading-snug", it.warn ? "text-amber-800" : "text-muted-foreground")}>{it.status}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={() => onStep("tablo")}
        aria-current={step === "tablo" ? "page" : undefined}
        className={cn(
          "flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          step === "tablo" ? "border-primary bg-primary/5 text-primary" : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
        )}
      >
        <Table2 className="h-4 w-4" />
        Tüm tablo
      </button>
    </nav>
  );
}
