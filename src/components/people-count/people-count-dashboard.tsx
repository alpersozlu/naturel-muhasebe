"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Radio, TriangleAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { ChartSkeleton } from "@/components/shared/skeleton";

/**
 * Kişi Sayımı paneli — kameradan aktarılan saatlik giren/çıkan verisi.
 * Bugün vs dün saatlik karşılaştırma + günlük trend (7 günlük ortalamayla).
 */

const TODAY_COLOR = "#0EA5E9"; // sky-500 (seçili gün)
const COMPARE_COLOR = "#94A3B8"; // slate-400 (dün / referans)
const SALES_COLOR = "#A855F7"; // purple-500 (satış/dönüşüm — z-analiz konvansiyonu)

const NUM = new Intl.NumberFormat("tr-TR");
const TRY0 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const DATE_SHORT = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
const DATE_LONG = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  weekday: "long",
});

const STORE_LABELS: Record<string, string> = {
  S01: "Lefkoşa",
  S02: "Mağusa",
  S03: "Girne",
};

type Metric = "enter" | "exit";
const METRIC_LABEL: Record<Metric, string> = { enter: "Giren", exit: "Çıkan" };

type HourRow = { hour: number; enter: number; exit: number };

function localToday(): string {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD (tarayıcı saati)
}

function sum(rows: HourRow[], metric: Metric, upToHour?: number): number {
  let t = 0;
  for (const r of rows) {
    if (upToHour === undefined || r.hour <= upToHour) t += r[metric];
  }
  return t;
}

function fmtDate(date: string, f: Intl.DateTimeFormat): string {
  return f.format(new Date(`${date}T12:00:00`));
}

export function PeopleCountDashboard() {
  const [date, setDate] = useState(localToday);
  const [metric, setMetric] = useState<Metric>("enter");
  const [rangeDays, setRangeDays] = useState(30);
  const [storeCode, setStoreCode] = useState<string>("");

  const isToday = date === localToday();

  const storesQ = trpc.peopleCount.stores.useQuery();
  const summaryQ = trpc.peopleCount.summary.useQuery(
    { date, store_code: storeCode || undefined },
    { refetchInterval: 60_000 }
  );
  const dailyQ = trpc.peopleCount.daily.useQuery(
    { endDate: date, days: rangeDays + 6, store_code: storeCode || undefined },
    { refetchInterval: 300_000 }
  );
  const conversionQ = trpc.peopleCount.conversion.useQuery(
    { endDate: date, days: rangeDays, store_code: storeCode || undefined },
    { refetchInterval: 300_000 }
  );

  const s = summaryQ.data;

  // ── KPI hesapları ─────────────────────────────────────────
  // Adil kıyas: iki taraf da son TAM saate kadar toplanır (cari kısmi saat
  // hariç) — yoksa bugünün 5 dakikalık dilimi dünün 60 dakikasıyla kıyaslanır
  // ve delta her saat başında yapay olarak düşer. Geçmiş günde tam gün kıyası.
  const nowHour = new Date().getHours();
  const cutoff = isToday ? nowHour - 1 : undefined;
  const bugunToplam = s ? sum(s.bugun.rows, metric) : 0;
  const bugunKiyas = s ? sum(s.bugun.rows, metric, cutoff) : 0;
  const dunToplam = s ? sum(s.dun.rows, metric) : 0;
  const dunAyniSaat = s ? sum(s.dun.rows, metric, cutoff) : 0;
  const ghToplam = s ? sum(s.gecenHafta.rows, metric) : 0;
  const ghAyniSaat = s ? sum(s.gecenHafta.rows, metric, cutoff) : 0;
  const tepe = useMemo(() => {
    if (!s) return null;
    let best: HourRow | null = null;
    for (const r of s.bugun.rows) {
      if (r[metric] > 0 && (!best || r[metric] > best[metric])) best = r;
    }
    return best;
  }, [s, metric]);
  const deltaPct =
    dunAyniSaat > 0 ? ((bugunKiyas - dunAyniSaat) / dunAyniSaat) * 100 : null;

  // ── canlı rozeti ──────────────────────────────────────────
  const sonGuncelleme = s?.sonGuncelleme ? new Date(s.sonGuncelleme) : null;
  const veriTaze =
    sonGuncelleme !== null && Date.now() - sonGuncelleme.getTime() < 30 * 60_000;

  // ── saatlik grafik verisi ─────────────────────────────────
  const hourlyData = useMemo(() => {
    if (!s) return [];
    const by = (rows: HourRow[]) => {
      const m = new Map<number, number>();
      for (const r of rows) m.set(r.hour, r[metric]);
      return m;
    };
    const bugunMap = by(s.bugun.rows);
    const dunMap = by(s.dun.rows);
    let first = 8;
    let last = 21;
    for (let h = 0; h < 24; h++) {
      if ((bugunMap.get(h) ?? 0) > 0 || (dunMap.get(h) ?? 0) > 0) {
        first = Math.min(first, h);
        last = Math.max(last, h);
      }
    }
    const out: { saat: string; Bugün: number; Dün: number }[] = [];
    for (let h = first; h <= last; h++) {
      out.push({
        saat: String(h).padStart(2, "0"),
        ["Bugün"]: bugunMap.get(h) ?? 0,
        ["Dün"]: dunMap.get(h) ?? 0,
      });
    }
    return out;
  }, [s, metric]);

  // ── trend grafiği verisi (7 günlük hareketli ortalama) ────
  // Takvim günü bazlı: pencere son 7 TAKVİM günüdür; verisi olmayan günler
  // grafikte boşluk olarak görünür (0 sanılmasın) ve ortalamaya katılmaz.
  const trendData = useMemo(() => {
    const all = dailyQ.data ?? [];
    if (all.length === 0) return [];
    const byDate = new Map(all.map((d) => [d.date, d[metric]]));
    const addDays = (iso: string, n: number) => {
      const t = new Date(`${iso}T00:00:00Z`);
      t.setUTCDate(t.getUTCDate() + n);
      return t.toISOString().slice(0, 10);
    };
    const out: Record<string, string | number | null>[] = [];
    for (let i = rangeDays - 1; i >= 0; i--) {
      const day = addDays(date, -i);
      const win: number[] = [];
      for (let k = 0; k < 7; k++) {
        const v = byDate.get(addDays(day, -k));
        if (v !== undefined) win.push(v);
      }
      out.push({
        tarih: fmtDate(day, DATE_SHORT),
        [METRIC_LABEL[metric]]: byDate.get(day) ?? null,
        "7 gün ort.": win.length
          ? Math.round((win.reduce((a, b) => a + b, 0) / win.length) * 10) / 10
          : null,
      });
    }
    return out;
  }, [dailyQ.data, rangeDays, metric, date]);

  // ── dönüşüm (ziyaretçi × NEBIM satış) ─────────────────────
  const seciliDonusum = useMemo(
    () => (conversionQ.data ?? []).find((d) => d.date === date) ?? null,
    [conversionQ.data, date]
  );
  const donusumData = useMemo(
    () =>
      (conversionQ.data ?? []).map((d) => ({
        tarih: fmtDate(d.date, DATE_SHORT),
        ["Ziyaretçi"]: d.giren,
        ["Dönüşüm %"]: d.donusum,
      })),
    [conversionQ.data]
  );
  const donusumVar = useMemo(
    () => (conversionQ.data ?? []).some((d) => d.donusum !== null),
    [conversionQ.data]
  );

  const stores = storesQ.data ?? [];
  const storeLabel = (code: string) => STORE_LABELS[code] ?? code;
  // hourlyData boş güne bile 08-21 sıfır penceresi üretir; gerçek boşluk
  // kontrolü ham satırlardan yapılır (sıfır grafik "kimse gelmedi" okunmasın).
  const gunBos =
    !!s && s.bugun.rows.length === 0 && s.dun.rows.length === 0;

  return (
    <div className="space-y-4">
      {/* Filtre satırı + canlı rozeti */}
      <div className="flex flex-wrap items-center gap-3">
        {stores.length > 1 ? (
          <select
            value={storeCode}
            onChange={(e) => setStoreCode(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="">Tüm mağazalar</option>
            {stores.map((c) => (
              <option key={c} value={c}>
                {storeLabel(c)}
              </option>
            ))}
          </select>
        ) : stores.length === 1 ? (
          <span className="text-sm font-medium">{storeLabel(stores[0]!)}</span>
        ) : null}

        <input
          type="date"
          value={date}
          max={localToday()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
        />

        <div className="inline-flex rounded-xl border border-border bg-muted/40 p-1">
          {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                metric === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 text-sm">
          {/* Tazelik rozeti sadece bugün için anlamlı; geçmiş günde gösterme */}
          {isToday ? (
            veriTaze ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-600">
                <Radio className="h-4 w-4" />
                Canlı · {sonGuncelleme!.toLocaleTimeString("tr-TR").slice(0, 5)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-amber-600">
                <TriangleAlert className="h-4 w-4" />
                {sonGuncelleme
                  ? `Veri gecikti · son: ${sonGuncelleme.toLocaleString("tr-TR")}`
                  : "Bugün için henüz veri yok"}
              </span>
            )
          ) : null}
        </div>
      </div>

      {/* KPI kartları */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">
              {isToday ? "Bugün" : fmtDate(date, DATE_SHORT)} {METRIC_LABEL[metric].toLowerCase()}
            </div>
            <div className="mt-1 text-4xl font-semibold tracking-tight">
              {NUM.format(bugunToplam)}
            </div>
            {deltaPct !== null ? (
              <div className="mt-1 flex items-center gap-1 text-sm">
                {deltaPct >= 0 ? (
                  <ArrowUpRight className="h-4 w-4 text-emerald-600" />
                ) : (
                  <ArrowDownRight className="h-4 w-4 text-red-600" />
                )}
                <span
                  className={deltaPct >= 0 ? "text-emerald-600" : "text-red-600"}
                >
                  %{Math.abs(deltaPct).toFixed(0)}
                </span>
                <span className="text-muted-foreground">
                  düne göre{isToday ? " (son tam saate kadar)" : ""}
                </span>
              </div>
            ) : (
              <div className="mt-1 text-sm text-muted-foreground">
                dünle karşılaştırma için veri yok
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">
              {isToday
                ? "Dün toplam"
                : `Önceki gün toplamı${s ? ` (${fmtDate(s.dun.date, DATE_SHORT)})` : ""}`}
            </div>
            <div className="mt-1 text-4xl font-semibold tracking-tight">
              {NUM.format(dunToplam)}
            </div>
            {isToday ? (
              <div className="mt-1 text-sm text-muted-foreground">
                son tam saate kadar: {NUM.format(dunAyniSaat)}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">
              Geçen hafta aynı gün
              {s ? ` (${fmtDate(s.gecenHafta.date, DATE_SHORT)})` : ""}
            </div>
            <div className="mt-1 text-4xl font-semibold tracking-tight">
              {NUM.format(ghToplam)}
            </div>
            {isToday ? (
              <div className="mt-1 text-sm text-muted-foreground">
                son tam saate kadar: {NUM.format(ghAyniSaat)}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Günün tepe saati</div>
            <div className="mt-1 text-4xl font-semibold tracking-tight">
              {tepe
                ? `${String(tepe.hour).padStart(2, "0")}:00–${String(tepe.hour + 1).padStart(2, "0")}:00`
                : "—"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {tepe ? `${NUM.format(tepe[metric])} kişi` : "henüz veri yok"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Saatlik: bugün vs dün */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 text-sm font-medium">
            Saatlik {METRIC_LABEL[metric].toLowerCase()} — {isToday ? "bugün" : fmtDate(date, DATE_LONG)} vs önceki gün
          </div>
          {summaryQ.isLoading ? (
            <ChartSkeleton />
          ) : gunBos ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Bu gün için veri yok.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={hourlyData} barGap={2}>
                <CartesianGrid strokeDasharray="0" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="saat" tick={{ fontSize: 12 }} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
                <Tooltip
                  formatter={(v) => NUM.format(Number(v ?? 0))}
                  labelFormatter={(l) => `${l}:00–${String(Number(l) + 1).padStart(2, "0")}:00`}
                />
                <Legend />
                <Bar dataKey="Bugün" name={isToday ? "Bugün" : "Seçili gün"} fill={TODAY_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="Dün" name="Önceki gün" fill={COMPARE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          )}
          {!gunBos && hourlyData.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Tabloyu göster
              </summary>
              <table className="mt-2 text-sm">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="pr-6 text-left font-medium">Saat</th>
                    <th className="pr-6 text-right font-medium">{isToday ? "Bugün" : "Seçili gün"}</th>
                    <th className="text-right font-medium">Önceki gün</th>
                  </tr>
                </thead>
                <tbody>
                  {hourlyData.map((r) => (
                    <tr key={r.saat} className="border-t border-border/60">
                      <td className="pr-6 py-1">{r.saat}:00</td>
                      <td className="pr-6 py-1 text-right tabular-nums">{NUM.format(r["Bugün"])}</td>
                      <td className="py-1 text-right tabular-nums">{NUM.format(r["Dün"])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
        </CardContent>
      </Card>

      {/* Günlük trend */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">
              Günlük {METRIC_LABEL[metric].toLowerCase()} — son {rangeDays === 365 ? "1 yıl" : `${rangeDays} gün`}
            </div>
            <div className="inline-flex rounded-xl border border-border bg-muted/40 p-1">
              {[7, 30, 90, 365].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRangeDays(n)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    rangeDays === n
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {n === 365 ? "1 yıl" : `${n} gün`}
                </button>
              ))}
            </div>
          </div>
          {dailyQ.isLoading ? (
            <ChartSkeleton />
          ) : trendData.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Bu aralık için veri yok.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={trendData}>
                <CartesianGrid strokeDasharray="0" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="tarih" tick={{ fontSize: 12 }} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} width={42} />
                <Tooltip formatter={(v) => NUM.format(Number(v ?? 0))} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey={METRIC_LABEL[metric]}
                  stroke={TODAY_COLOR}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="7 gün ort."
                  stroke={COMPARE_COLOR}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Dönüşüm: ziyaretçi × NEBIM satış */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3">
            <div className="text-sm font-medium">
              Dönüşüm oranı — ziyaretçi × satış (NEBIM)
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Kaç ziyaretçiden kaçı alışveriş yaptı: iade hariç tekil fiş sayısı
              ÷ giren kişi. Satış verisi olmayan günler boş bırakılır.
            </p>
          </div>

          {/* Seçili gün mini-KPI'ları */}
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-border/60 p-3">
              <div className="text-xs text-muted-foreground">
                {isToday ? "Bugün dönüşüm" : "Seçili gün dönüşüm"}
              </div>
              <div className="mt-0.5 text-2xl font-semibold tracking-tight">
                {seciliDonusum?.donusum !== null && seciliDonusum?.donusum !== undefined
                  ? `%${NUM.format(seciliDonusum.donusum)}`
                  : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <div className="text-xs text-muted-foreground">Fiş sayısı</div>
              <div className="mt-0.5 text-2xl font-semibold tracking-tight">
                {seciliDonusum?.fis !== null && seciliDonusum?.fis !== undefined
                  ? NUM.format(seciliDonusum.fis)
                  : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <div className="text-xs text-muted-foreground">Ziyaretçi başına ciro</div>
              <div className="mt-0.5 text-2xl font-semibold tracking-tight">
                {seciliDonusum &&
                seciliDonusum.ciro !== null &&
                seciliDonusum.giren !== null &&
                seciliDonusum.giren > 0
                  ? `${TRY0.format(seciliDonusum.ciro / seciliDonusum.giren)} ₺`
                  : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <div className="text-xs text-muted-foreground">Günün cirosu (net)</div>
              <div className="mt-0.5 text-2xl font-semibold tracking-tight">
                {seciliDonusum?.ciro !== null && seciliDonusum?.ciro !== undefined
                  ? `${TRY0.format(seciliDonusum.ciro)} ₺`
                  : "—"}
              </div>
            </div>
          </div>

          {conversionQ.isLoading ? (
            <ChartSkeleton />
          ) : !donusumVar ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Bu aralıkta ziyaretçi ve NEBIM satışının kesiştiği gün yok.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={donusumData}>
                <CartesianGrid strokeDasharray="0" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="tarih" tick={{ fontSize: 12 }} tickLine={false} minTickGap={24} />
                <YAxis
                  yAxisId="sol"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={42}
                />
                <YAxis
                  yAxisId="sag"
                  orientation="right"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `%${v}`}
                  width={44}
                />
                <Tooltip
                  formatter={(v, name) =>
                    name === "Dönüşüm %"
                      ? `%${NUM.format(Number(v ?? 0))}`
                      : NUM.format(Number(v ?? 0))
                  }
                />
                <Legend />
                <Bar
                  yAxisId="sol"
                  dataKey="Ziyaretçi"
                  fill={TODAY_COLOR}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={22}
                />
                <Line
                  yAxisId="sag"
                  type="monotone"
                  dataKey="Dönüşüm %"
                  stroke={SALES_COLOR}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
