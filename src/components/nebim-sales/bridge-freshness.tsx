"use client";

import { AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";

/**
 * Age of the Nebim data. Quiet line when fresh; a warning when the bridge on
 * the store PC has stopped delivering. Thresholds follow the schedule: hourly
 * between 09:00 and 24:00, so three silent hours in the daytime is already
 * unusual and more than a day means the scheduled task is not running.
 */
export function BridgeFreshness({ onlyWhenStale = false }: { onlyWhenStale?: boolean }) {
  const q = trpc.nebimSales.freshness.useQuery(undefined, {
    refetchInterval: 10 * 60_000,
    refetchOnWindowFocus: true,
  });
  const last = q.data?.last_ingest_at ? new Date(q.data.last_ingest_at) : null;
  if (!last) return null;

  const ageH = (Date.now() - last.getTime()) / 3_600_000;
  const when = last.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  });
  const hourNow = Number(
    new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Istanbul" })
  );
  const daytime = hourNow >= 11;

  if (ageH >= 26) {
    const days = Math.floor(ageH / 24);
    return (
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <span className="font-medium">Nebim aktarımı {days} gündür gelmiyor.</span> Son aktarım {when}. Bu
          tarihten sonraki satışlar burada görünmez. Nebim bilgisayarında köprü klasöründeki{" "}
          <span className="font-medium">ZAMANLAYICI-ONAR.bat</span> dosyasına çift tıklayın; eksik günler
          kendiliğinden tamamlanır.
        </div>
      </div>
    );
  }
  if (onlyWhenStale) return null;
  if (ageH >= 3 && daytime) {
    return (
      <p className="mb-4 text-xs text-amber-800">
        Son Nebim aktarımı {when} ({Math.floor(ageH)} saat önce). Aktarım normalde saatte bir gelir.
      </p>
    );
  }
  return <p className="mb-4 text-xs text-muted-foreground">Son Nebim aktarımı: {when}</p>;
}
