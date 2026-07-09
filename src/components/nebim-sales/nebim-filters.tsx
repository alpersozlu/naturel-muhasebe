"use client";

import { useEffect, useMemo, useState } from "react";
import { X, ChevronLeft, ChevronRight, CalendarDays, Store as StoreIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type NebimSalesSelection = {
  storeId: string;
  dateFrom: string;
  dateTo: string;
  onlyReturns: boolean;
  discountBand: string; // "" = tümü; discounted/none/b1..b5
};

const DISCOUNT_OPTIONS: Array<[string, string]> = [
  ["all", "Tümü"],
  ["discounted", "İndirimli (hepsi)"],
  ["none", "İndirimsiz"],
  ["b1", "%0–10"],
  ["b2", "%10–25"],
  ["b3", "%25–40"],
  ["b4", "%40–60"],
  ["b5", "%60+"],
];

// ── Tarih yardımcıları (yerel takvim; NEBIM verisi 2026-01'den başlar) ──
const DATA_START = { y: 2026, m: 1 };
const MONTH_TR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** "2026-06" → { from: "2026-06-01", to: "2026-06-30" } */
function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

function isFullMonth(from: string, to: string): boolean {
  if (!from || !to || !from.endsWith("-01")) return false;
  return monthBounds(from.slice(0, 7)).to === to;
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTH_TR[Number(m) - 1]} ${y}`;
}

function fmtDayTr(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTH_TR[Number(m) - 1]} ${y}`;
}

/** Veri başlangıcından bu aya kadar ay listesi (yeni → eski). */
function monthOptions(): string[] {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  const out: string[] = [];
  while (y > DATA_START.y || (y === DATA_START.y && m >= DATA_START.m)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

type DateMode = "month" | "range" | "single";

function deriveMode(from: string, to: string): DateMode {
  if (isFullMonth(from, to)) return "month";
  if (from && from === to) return "single";
  return "range";
}

export function NebimFilters({
  value,
  onChange,
  hideStore = false,
}: {
  value: NebimSalesSelection;
  onChange: (v: NebimSalesSelection) => void;
  /** Analiz sekmesinde mağaza seçimi Karne kartlarından yapılır — pill'ler gizlenir. */
  hideStore?: boolean;
}) {
  // NEBIM verisi yalnız Derimod markasina ait — mağaza listesini ondan çek.
  const { data: brands } = trpc.brand.list.useQuery();
  const derimod = useMemo(
    () => (brands ?? []).find((b) => /derimod/i.test(b.name)),
    [brands]
  );
  const { data: stores } = trpc.store.listByBrand.useQuery(
    { brand_id: derimod?.id ?? "" },
    { enabled: !!derimod?.id }
  );

  const months = useMemo(monthOptions, []);
  const [mode, setMode] = useState<DateMode>(() =>
    deriveMode(value.dateFrom, value.dateTo)
  );

  // Tarih dışarıdan değişirse (başka sekmenin kısayolu) modu senkron tut.
  useEffect(() => {
    if (mode === "month" && !isFullMonth(value.dateFrom, value.dateTo)) {
      setMode(deriveMode(value.dateFrom, value.dateTo));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.dateFrom, value.dateTo]);

  const setDates = (from: string, to: string) =>
    onChange({ ...value, dateFrom: from, dateTo: to });

  const switchMode = (m: DateMode) => {
    setMode(m);
    if (m === "month") {
      // Mevcut başlangıcın ayına (yoksa bu aya) tam-ay olarak oturt.
      const ym = (value.dateFrom || todayIso()).slice(0, 7);
      const target = months.includes(ym) ? ym : months[0]!;
      const b = monthBounds(target);
      setDates(b.from, b.to);
    } else if (m === "single") {
      const d = value.dateFrom || todayIso();
      setDates(d, d);
    }
    // "range": mevcut değerler korunur, kullanıcı düzenler.
  };

  const currentMonth = isFullMonth(value.dateFrom, value.dateTo)
    ? value.dateFrom.slice(0, 7)
    : null;
  const monthIdx = currentMonth ? months.indexOf(currentMonth) : -1;
  const gotoMonth = (ym: string) => {
    const b = monthBounds(ym);
    setDates(b.from, b.to);
  };

  // Sağ üstteki dönem özeti — sunum kalitesinde tek bakışta durum.
  const summary = (() => {
    if (!value.dateFrom && !value.dateTo) return "Tüm zaman";
    if (currentMonth) return fmtMonth(currentMonth);
    if (value.dateFrom && value.dateFrom === value.dateTo)
      return fmtDayTr(value.dateFrom);
    const days =
      value.dateFrom && value.dateTo
        ? Math.round(
            (new Date(value.dateTo).getTime() - new Date(value.dateFrom).getTime()) /
              86400000
          ) + 1
        : null;
    return `${fmtDayTr(value.dateFrom) || "…"} – ${fmtDayTr(value.dateTo) || "…"}${
      days ? ` · ${days} gün` : ""
    }`;
  })();

  const hasAny =
    !!value.storeId ||
    !!value.dateFrom ||
    !!value.dateTo ||
    value.onlyReturns ||
    (!!value.discountBand && value.discountBand !== "all");

  const storeDot = (name: string) => {
    const n = name.toLocaleLowerCase("tr").replace(/ı/g, "i");
    if (n.includes("lefkosa")) return "bg-blue-500";
    if (n.includes("girne")) return "bg-emerald-500";
    if (n.includes("magusa")) return "bg-amber-500";
    return "bg-slate-400";
  };

  const chip = (label: string, onClick: () => void, active = false) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/40"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="rounded-xl border border-border/70 bg-card mb-6 overflow-hidden">
      {/* Üst şerit: başlık + dönem özeti + temizle */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 bg-muted/30">
        <span className="text-sm font-semibold">Filtreler</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-[11px] font-semibold">
          <CalendarDays className="h-3.5 w-3.5" />
          {summary}
        </span>
        {value.storeId ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-foreground/80">
            <StoreIcon className="h-3 w-3" />
            {(stores ?? []).find((s) => s.id === value.storeId)?.name.replace(/^DERIMOD\s*/i, "") ?? "Mağaza"}
          </span>
        ) : null}
        {hasAny ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground ml-auto"
            onClick={() => {
              setMode("range");
              onChange({
                storeId: "",
                dateFrom: "",
                dateTo: "",
                onlyReturns: false,
                discountBand: "",
              });
            }}
          >
            <X className="h-3 w-3 mr-1" />
            Temizle
          </Button>
        ) : null}
      </div>

      <div className="p-4 flex flex-wrap items-start gap-x-8 gap-y-4">
        {/* Mağaza — tek tık pill'ler (Analiz'de Karne kartları bu işi görür) */}
        <div className={hideStore ? "hidden" : "space-y-1.5"}>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Mağaza
          </Label>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onChange({ ...value, storeId: "" })}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                !value.storeId
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              Tümü
            </button>
            {(stores ?? []).map((s) => {
              const active = value.storeId === s.id;
              const short = s.name.replace(/^DERIMOD\s*/i, "");
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onChange({ ...value, storeId: active ? "" : s.id })}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    active
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${active ? "bg-primary-foreground" : storeDot(s.name)}`} />
                  {short}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dönem — Ay / Aralık / Tek Gün */}
        <div className="space-y-1.5 min-w-[300px]">
          <div className="flex items-center gap-2">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Dönem
            </Label>
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
              {(
                [
                  ["month", "Ay"],
                  ["range", "Aralık"],
                  ["single", "Tek Gün"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    mode === m
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === "month" ? (
            <div className="flex items-center gap-1.5">
              {/* ◀ eski ay */}
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-9 p-0"
                disabled={monthIdx < 0 ? false : monthIdx >= months.length - 1}
                onClick={() => {
                  const i = monthIdx < 0 ? 0 : monthIdx + 1;
                  if (months[i]) gotoMonth(months[i]!);
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Select
                value={currentMonth ?? ""}
                onValueChange={(v) => gotoMonth(v)}
              >
                <SelectTrigger className="h-9 w-44 font-medium">
                  <SelectValue placeholder="Ay seç…" />
                </SelectTrigger>
                <SelectContent>
                  {months.map((ym) => (
                    <SelectItem key={ym} value={ym}>
                      {fmtMonth(ym)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* ▶ yeni ay */}
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-9 p-0"
                disabled={monthIdx <= 0}
                onClick={() => {
                  if (monthIdx > 0) gotoMonth(months[monthIdx - 1]!);
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : mode === "single" ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                type="date"
                className="h-9 w-40"
                value={value.dateFrom}
                onChange={(e) => setDates(e.target.value, e.target.value)}
              />
              {chip("Bugün", () => setDates(todayIso(), todayIso()), value.dateFrom === todayIso())}
              {chip("Dün", () => {
                const y = shiftDays(todayIso(), -1);
                setDates(y, y);
              }, value.dateFrom === shiftDays(todayIso(), -1))}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  className="h-9 w-40"
                  value={value.dateFrom}
                  onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
                />
                <span className="text-muted-foreground text-sm">–</span>
                <Input
                  type="date"
                  className="h-9 w-40"
                  value={value.dateTo}
                  onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {chip("Son 7 Gün", () => setDates(shiftDays(todayIso(), -6), todayIso()))}
                {chip("Son 30 Gün", () => setDates(shiftDays(todayIso(), -29), todayIso()))}
                {chip("Bu Yıl", () => setDates(`${new Date().getFullYear()}-01-01`, todayIso()))}
                {chip("Tüm Zaman", () => setDates("", ""), !value.dateFrom && !value.dateTo)}
              </div>
            </div>
          )}
        </div>

        {/* Kayıt Tipi + İndirim */}
        <div className="flex gap-3 ml-auto">
          <div className="space-y-1.5 w-36">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Kayıt Tipi
            </Label>
            <Select
              value={value.onlyReturns ? "returns" : "all"}
              onValueChange={(v) =>
                onChange({ ...value, onlyReturns: v === "returns" })
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tümü</SelectItem>
                <SelectItem value="returns">Sadece İadeler</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 w-36">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              İndirim
            </Label>
            <Select
              value={value.discountBand || "all"}
              onValueChange={(v) =>
                onChange({ ...value, discountBand: v === "all" ? "" : v })
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DISCOUNT_OPTIONS.map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
