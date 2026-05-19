"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { useRouter, usePathname, Link } from "@/i18n/navigation";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/shared/skeleton";
import { Button } from "@/components/ui/button";

const MONTH_NAMES = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

const WEEKDAY_LABELS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

type DayStatus = "empty" | "error" | "partial" | "verified" | "locked";

const STATUS_STYLE: Record<
  DayStatus,
  { bg: string; ring: string; dot: string; label: string }
> = {
  empty: {
    bg: "bg-muted/30 hover:bg-muted/50",
    ring: "ring-1 ring-transparent",
    dot: "bg-muted-foreground/20",
    label: "Boş",
  },
  partial: {
    bg: "bg-amber-50 hover:bg-amber-100",
    ring: "ring-1 ring-amber-200",
    dot: "bg-amber-500",
    label: "Kısmi",
  },
  verified: {
    bg: "bg-emerald-50 hover:bg-emerald-100",
    ring: "ring-1 ring-emerald-200",
    dot: "bg-emerald-500",
    label: "Onaylı",
  },
  error: {
    bg: "bg-rose-50 hover:bg-rose-100",
    ring: "ring-1 ring-rose-200",
    dot: "bg-rose-500",
    label: "Hatalı",
  },
  locked: {
    bg: "bg-slate-100 hover:bg-slate-150",
    ring: "ring-1 ring-slate-300",
    dot: "bg-slate-500",
    label: "Kilitli",
  },
};

export function StoreCalendar({
  storeId,
  year,
  month,
}: {
  storeId: string;
  year: number;
  month: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { data, isLoading } = trpc.store.getMonthlyCalendar.useQuery({
    store_id: storeId,
    year,
    month,
  });

  const navigate = (y: number, m: number) => {
    const monthParam = `${y}-${String(m).padStart(2, "0")}`;
    router.push(`${pathname}?month=${monthParam}`);
  };

  const handlePrev = () => {
    if (month === 1) navigate(year - 1, 12);
    else navigate(year, month - 1);
  };

  const handleNext = () => {
    if (month === 12) navigate(year + 1, 1);
    else navigate(year, month + 1);
  };

  const handleToday = () => {
    const now = new Date();
    navigate(now.getUTCFullYear(), now.getUTCMonth() + 1);
  };

  // Layout offset: the calendar starts on Monday. JS Date.getUTCDay() returns
  // 0 (Sun)..6 (Sat); convert to Mon=0..Sun=6.
  const leadingBlanks = useMemo(() => {
    const firstDay = new Date(Date.UTC(year, month - 1, 1));
    const jsDay = firstDay.getUTCDay(); // 0=Sun..6=Sat
    return (jsDay + 6) % 7; // Mon=0..Sun=6
  }, [year, month]);

  const isCurrentMonth = useMemo(() => {
    const now = new Date();
    return now.getUTCFullYear() === year && now.getUTCMonth() + 1 === month;
  }, [year, month]);

  const todayIso = useMemo(() => {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
  }, []);

  return (
    <Card>
      <CardContent className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-primary" />
            <div className="text-lg font-semibold">
              {MONTH_NAMES[month - 1]} {year}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={handlePrev} className="h-9 w-9">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleToday}
              disabled={isCurrentMonth}
              className="h-9"
            >
              Bugün
            </Button>
            <Button variant="ghost" size="icon" onClick={handleNext} className="h-9 w-9">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-2 mb-2">
          {WEEKDAY_LABELS.map((d) => (
            <div
              key={d}
              className="text-xs font-medium text-muted-foreground text-center py-1"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`blank-${i}`} className="aspect-square" />
            ))}
            {data?.days.map((d) => {
              const style = STATUS_STYLE[d.status];
              const isToday = d.iso === todayIso;
              const summary = [
                d.has_z ? "Z ✓" : "Z ✗",
                `${d.pos_slip_count} POS`,
                d.has_store_summary ? "Özet ✓" : "Özet ✗",
              ].join(" · ");

              return (
                <Link
                  key={d.iso}
                  href={`/stores/${storeId}/days/${d.iso}`}
                  title={`${d.day} ${MONTH_NAMES[month - 1]} — ${style.label}\n${summary}\nYükleme: ${d.upload_count}`}
                  className={`aspect-square rounded-xl p-2 text-left transition-all ${style.bg} ${style.ring} ${
                    isToday ? "ring-2 ring-primary/40" : ""
                  } focus:outline-none focus-visible:ring-2 focus-visible:ring-primary flex flex-col hover:scale-[1.02] active:scale-100`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div
                      className={`text-sm font-semibold tabular-nums ${
                        isToday ? "text-primary" : "text-foreground"
                      }`}
                    >
                      {d.day}
                    </div>
                    {d.status !== "empty" ? (
                      <div className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                    ) : null}
                  </div>
                  {d.upload_count > 0 ? (
                    <div className="mt-auto text-[10px] leading-tight text-muted-foreground">
                      {d.upload_count} dosya
                    </div>
                  ) : null}
                </Link>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="mt-6 pt-4 border-t flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {(Object.keys(STATUS_STYLE) as DayStatus[]).map((s) => (
            <div key={s} className="flex items-center gap-1.5">
              <div className={`h-2 w-2 rounded-full ${STATUS_STYLE[s].dot}`} />
              {STATUS_STYLE[s].label}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
