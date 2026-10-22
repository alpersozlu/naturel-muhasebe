"use client";

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { AlarmClock, Cake, ChevronRight, FileWarning, Flag, Loader2, Palmtree, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Avatar } from "./avatar";
import { addDays, dayLong, dayMonth } from "./format";

type Feed = inferRouterOutputs<AppRouter>["hr"]["feed"];
type Item = Feed["days"][number]["items"][number];
type Filter = "all" | "leave" | "birthday" | "anniversary" | "alert";

const LEAVE_LABEL: Record<string, string> = { annual: "Yıllık izin", lieu: "Hak günü", sick: "Hastalık izni", bereavement: "Vefat izni", unpaid: "Ücretsiz izin" };

const ICON: Record<Item["type"], { icon: React.ReactNode; cls: string }> = {
  leave: { icon: <Palmtree className="h-4 w-4" />, cls: "bg-emerald-500" },
  birthday: { icon: <Cake className="h-4 w-4" />, cls: "bg-pink-500" },
  anniversary: { icon: <Trophy className="h-4 w-4" />, cls: "bg-amber-500" },
  holiday: { icon: <Flag className="h-4 w-4" />, cls: "bg-red-500" },
  lieu_deadline: { icon: <AlarmClock className="h-4 w-4" />, cls: "bg-rose-600" },
  document: { icon: <FileWarning className="h-4 w-4" />, cls: "bg-orange-500" },
};

const matches = (f: Filter, it: Item) =>
  f === "all" || (f === "leave" && it.type === "leave") || (f === "birthday" && it.type === "birthday") || (f === "anniversary" && it.type === "anniversary") || (f === "alert" && (it.type === "lieu_deadline" || it.type === "document" || it.type === "holiday"));

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Nicosia", hour: "numeric", hour12: false }).format(new Date()));
  return h < 12 ? "Günaydın" : h < 18 ? "İyi günler" : "İyi akşamlar";
}

function dayLabel(d: string, today: string): string {
  if (d === today) return `Bugün, ${dayLong(d)}`;
  if (d === addDays(today, 1)) return `Yarın, ${dayLong(d)}`;
  return dayLong(d);
}

function weekOf(d: string): string {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
  return addDays(d, -((dow + 6) % 7));
}

function texts(it: Item, viewer: Feed["viewer"]): { title: string; sub: string | null } {
  switch (it.type) {
    case "leave": {
      const span = it.halfDay ? "yarım gün" : it.until === it.date ? "tam gün" : `${dayMonth(it.until)} dahil`;
      return viewer === "staff" ? { title: `${it.name} izinli`, sub: span } : { title: `${it.name} izinde`, sub: `${it.kind ? LEAVE_LABEL[it.kind] : "İzin"} · ${span}` };
    }
    case "birthday":
      return { title: `${it.name} — doğum günü 🎂`, sub: "Kutlamayı unutmayın" };
    case "anniversary":
      return { title: `${it.name} — ${it.years}. iş yılı`, sub: `Naturel Ticaret'te ${it.years} yıl` };
    case "holiday":
      return { title: it.name, sub: "Resmi tatil — çalışan 1 hak günü kazanır" };
    case "lieu_deadline":
      return { title: `${it.name} — hak günü için son gün`, sub: `${dayMonth(it.worked)} çalışmasının karşılığı henüz kullanılmadı` };
    case "document":
      return { title: `${it.name} — ${it.doc === "work_permit" ? "çalışma izni" : "pasaport"} bitiyor`, sub: "Yenileme için şimdiden harekete geçin" };
  }
}

/** AJANDA sayfası — Kolay İK ana sayfasındaki akışın gelişmişi. */
export function HrFeed() {
  const q = trpc.hr.feed.useQuery({ days: 21 });
  const [filter, setFilter] = useState<Filter>("all");
  if (q.isLoading) return <Loader2 className="mx-auto mt-20 h-6 w-6 animate-spin text-muted-foreground" />;
  if (q.error || !q.data) return <p className="rounded-2xl border-2 border-red-200 bg-red-50 p-5 text-sm text-red-800">Ajanda açılamadı. {q.error?.message}</p>;
  const f = q.data;
  const todayItems = f.days.find((d) => d.date === f.today)?.items ?? [];
  const away = todayItems.filter((x) => x.type === "leave").length;
  const bdays = todayItems.filter((x) => x.type === "birthday").length;
  const filters: Array<[Filter, string]> = [
    ["all", "Tümü"],
    ["leave", "İzinler"],
    ["birthday", "Doğum günleri"],
    ["anniversary", "Yıldönümleri"],
    ...(f.viewer !== "staff" ? ([["alert", "Uyarılar"]] as Array<[Filter, string]>) : []),
  ];
  const days = f.days.map((d) => ({ ...d, items: d.items.filter((it) => matches(filter, it)) })).filter((d) => d.items.length);

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-400 p-5 text-white shadow-sm">
        <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-white/15" />
        <div className="absolute -bottom-10 right-10 h-24 w-24 rounded-full bg-white/10" />
        <div className="relative">
          <div className="text-2xl font-semibold">
            {greeting()} {f.name}! 👋
          </div>
          <div className="text-sm opacity-90">{dayLong(f.today)}</div>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-white/20 px-3 py-1">🌴 Bugün {away} kişi izinde</span>
            {bdays > 0 && <span className="rounded-full bg-white/20 px-3 py-1">🎂 {bdays} doğum günü</span>}
          </div>
        </div>
      </div>

      {f.viewer !== "staff" && f.stores.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-semibold text-muted-foreground">Bugün mağazalarda</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {f.stores.map((s) => (
              <div key={s.storeId} className="rounded-2xl border bg-white p-3">
                <div className="truncate text-sm font-medium">{s.store}</div>
                <div className="text-xl font-bold">
                  {s.total - s.away}
                  <span className="text-sm font-normal text-muted-foreground"> / {s.total} kişi</span>
                </div>
                {s.away > 0 && <div className="text-xs text-emerald-700">{s.away} izinde</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {filters.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={cn("shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium", filter === k ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200")}
          >
            {label}
          </button>
        ))}
      </div>

      {days.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Önümüzdeki günlerde gösterilecek bir şey yok.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-white">
          {days.map((d, i) => {
            const wk = weekOf(d.date);
            const newWeek = i === 0 || weekOf(days[i - 1]!.date) !== wk;
            return (
              <div key={d.date}>
                {newWeek && (
                  <div className="bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600">
                    {dayMonth(wk)} – {dayMonth(addDays(wk, 6))}
                  </div>
                )}
                <div className={cn("px-4 pt-3 text-sm font-medium", d.date === f.today ? "text-indigo-700" : "text-muted-foreground")}>{dayLabel(d.date, f.today)}</div>
                <ul>
                  {d.items.map((it, n) => (
                    <FeedRow key={`${it.type}-${"personId" in it ? it.personId : it.name}-${n}`} it={it} viewer={f.viewer} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FeedRow({ it, viewer }: { it: Item; viewer: Feed["viewer"] }) {
  const t = texts(it, viewer);
  const ic = ICON[it.type];
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      {"personId" in it ? <Avatar name={it.name} small /> : <span className="h-10 w-10 shrink-0" />}
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white", ic.cls)}>{ic.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="font-medium leading-snug">{t.title}</div>
        <div className="text-sm text-muted-foreground">
          {t.sub}
          {"store" in it && viewer !== "staff" && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{it.store}</span>}
        </div>
      </div>
    </li>
  );
}

/** Ana ekrandaki küçük özet: önümüzdeki 7 günün ilk birkaç satırı. */
export function FeedPreview() {
  const q = trpc.hr.feed.useQuery({ days: 7 });
  if (!q.data) return null;
  const items = q.data.days.flatMap((d) => d.items.map((it) => ({ ...it, day: d.date }))).slice(0, 4);
  return (
    <div className="rounded-2xl border bg-white">
      <div className="flex items-center justify-between px-4 pt-3">
        <h2 className="font-semibold">Bu hafta {q.data.viewer === "staff" ? "mağazanızda" : ""}</h2>
        <Link href="/ik/ajanda" className="flex items-center text-sm font-medium text-indigo-700">
          Ajanda <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="px-4 pb-4 pt-2 text-sm text-muted-foreground">Bu hafta izin, doğum günü ya da tatil yok.</p>
      ) : (
        <ul>
          {items.map((it, n) => {
            const t = texts(it, q.data.viewer);
            const ic = ICON[it.type];
            return (
              <li key={n} className="flex items-center gap-3 px-4 py-2.5">
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white", ic.cls)}>{ic.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.title}</div>
                  <div className="text-xs text-muted-foreground">{dayLabel(it.day, q.data.today)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
