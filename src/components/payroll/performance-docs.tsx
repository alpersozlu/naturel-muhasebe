"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarCheck, Check, FileUp, X } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { dmy, money, pct } from "./format";

type StorePerf = inferRouterOutputs<AppRouter>["payroll"]["performance"]["get"][number];
type Kind = StorePerf["docs"][number]["kind"];

const KIND_LABEL: Record<Kind, string> = {
  bi_pdf: "Çalışan Performans Raporu (PDF)",
  kpi_xlsx: "Personel KPI Raporu (xlsx)",
  itpos_kpi: "IT POS Performans (xlsx)",
  itpos_reps: "IT POS kişi tablosu (xlsx)",
};
const REQUIRED: Kind[] = ["bi_pdf", "kpi_xlsx", "itpos_kpi"];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const dayNums = (days: string[]) => days.map((d) => String(Number(d.slice(8, 10)))).join(", ");

/**
 * Ay sonu performans belgeleri — mağaza başına. Dosyalar sistemde okunur,
 * birbirleriyle karşılaştırılır; fark yoksa tek tuşla prim tablosuna aktarılır.
 * Fotoğraf gerekmez: SAP'den alınan PDF ve Excel dışa aktarımları yeter.
 *
 * Bağımsız kontrol: aynı kişi ciroları, ay boyunca her akşam yüklenen günlük
 * bayi gün sonu dosyalarından da hesaplanır ("Günlük dosyalar" sütunu). Eksik
 * günün dosyası da aynı düğmeyle eklenir.
 */
export function PerformanceDocs({
  periodId,
  storeId,
  closed,
  perf,
  onChanged,
  onApplied,
}: {
  periodId: string;
  storeId: string;
  closed: boolean;
  perf: StorePerf | undefined;
  onChanged: () => void;
  onApplied: () => void;
}) {
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = trpc.payroll.performance.upload.useMutation();
  const remove = trpc.payroll.performance.remove.useMutation({
    onSuccess: () => onChanged(),
    onError: (e) => toast.error(e.message),
  });
  const apply = trpc.payroll.performance.applyToLines.useMutation({
    onSuccess: (r) => {
      toast.success(
        `Prim tablosuna aktarıldı — ${r.updated} satır güncellendi${r.unchanged ? `, ${r.unchanged} satır zaten aynıydı` : ""}${
          r.top_seller ? ` · top-seller ${r.top_seller}` : ""
        }`
      );
      onApplied();
    },
    onError: (e) => toast.error(e.message),
  });

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        try {
          const r = await upload.mutateAsync({ period_id: periodId, store_id: storeId, file_name: f.name, file_base64: await fileToBase64(f) });
          if (r.kind === "daily_archive") {
            const range = r.date_min && r.date_max ? (r.date_min === r.date_max ? dmy(r.date_min) : `${dmy(r.date_min)} – ${dmy(r.date_max)}`) : "";
            if (r.mismatched.length) {
              toast.warning(
                `Bayi gün sonu dosyası (${range}): ${r.mismatched.length} günün toplamı sistemdeki günlük yüklemeden farklı — ${r.mismatched
                  .map((m) => `${dmy(m.date)}: sistemde ${money(m.on_file)}, dosyada ${money(m.in_file)}`)
                  .join("; ")}. Sistemdeki kayıt değiştirilmedi.`,
                { duration: 15000 }
              );
            } else if (r.written.length) {
              toast.success(`Bayi gün sonu dosyası (${range}): ${r.written.length} gün eklendi${r.kept.length ? `, ${r.kept.length} gün zaten vardı` : ""}`);
            } else {
              toast.info(`Bayi gün sonu dosyası (${range}): bu günlerin hepsi sistemde zaten var, aynı rakamlarla`);
            }
            if (r.genuine === false) toast.warning(`${f.name}: SAP'nin özgün dışa aktarımı değil — Excel'de yeniden kaydedilmiş`, { duration: 9000 });
          } else {
            toast.success(`${KIND_LABEL[r.kind]} okundu — ${f.name}`);
          }
        } catch (e) {
          toast.error(`${f.name}: ${e instanceof Error ? e.message : "okunamadı"}`, { duration: 9000 });
        }
      }
      onChanged();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const docs = perf?.docs ?? [];
  const check = perf?.check ?? null;
  const daily = check?.daily ?? null;
  const missing = REQUIRED.filter((k) => !docs.some((d) => d.kind === k));
  const hasError = !!check && (check.flags.some((f) => f.level === "error") || check.rows.some((r) => r.flags.some((f) => f.level === "error")));

  return (
    <div className="border-b bg-sky-50/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Performans belgeleri</span>
        {docs.map((d) => (
          <span key={d.id} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] ring-1 ring-border" title={`${d.file_name} · ${d.uploaded_by_name ?? ""}`}>
            <Check className="h-3 w-3 text-emerald-600" />
            {KIND_LABEL[d.kind]}
            {d.genuine === true ? <span className="text-emerald-700">· SAP özgün</span> : null}
            {d.genuine === false ? <span className="text-amber-700">· Excel&apos;de kaydedilmiş</span> : null}
            {!closed ? (
              <button
                type="button"
                className="ml-0.5 text-muted-foreground hover:text-rose-700"
                onClick={async () => {
                  if (await confirm({ title: "Belge kaldırılsın mı?", description: d.file_name, confirmLabel: "Kaldır", destructive: true })) remove.mutate({ id: d.id });
                }}
                aria-label="Belgeyi kaldır"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        ))}
        {missing.map((k) => (
          <span key={k} className="rounded-full px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-dashed ring-border">
            {KIND_LABEL[k]} — bekleniyor
          </span>
        ))}
        {daily && daily.days_present > 0 ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] ring-1 ring-border",
              daily.complete ? "text-foreground" : "text-amber-800"
            )}
            title={`${daily.upload_days} gün mağazanın günlük yüklemesinden, ${daily.archive_days} gün sonradan eklenen dosyalardan${
              daily.days_missing.length ? ` · eksik: ayın ${dayNums(daily.days_missing)}. günü` : ""
            }`}
          >
            <CalendarCheck className={cn("h-3 w-3", daily.complete ? "text-emerald-600" : "text-amber-700")} />
            Günlük bayi dosyaları {daily.days_present}/{daily.days_expected} gün
          </span>
        ) : null}
        <div className="flex-1" />
        <input ref={input} type="file" multiple accept=".xlsx,.pdf" className="hidden" onChange={(e) => void onFiles(e.target.files)} />
        <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy || closed}>
          <FileUp className="h-3.5 w-3.5 mr-1.5" />
          {busy ? "Okunuyor…" : "Belge yükle"}
        </Button>
        {check ? (
          <Button
            size="sm"
            onClick={async () => {
              if (check.ready) return apply.mutate({ period_id: periodId, store_id: storeId, force: false });
              const ok = await confirm({
                title: "Eksik belgeyle aktarılsın mı?",
                description:
                  "KPI dosyası olmadan denim ayrımı yapılamaz (cironun tamamı denim dışı sayılır). BI raporu ya da tam günlük dosyalar olmadan kişi cirosu eksik kalabilir.",
                confirmLabel: "Yine de aktar",
              });
              if (ok) apply.mutate({ period_id: periodId, store_id: storeId, force: true });
            }}
            disabled={apply.isPending || closed || hasError}
            title={hasError ? "Kırmızı farklar çözülmeden aktarılamaz" : undefined}
          >
            Prim tablosuna aktar
          </Button>
        ) : null}
      </div>

      {check ? (
        <details className="mt-2" open={hasError || check.flags.some((f) => f.level === "warn")}>
          <summary className="cursor-pointer select-none text-xs text-muted-foreground">
            Çapraz kontrol:{" "}
            <span className={cn("font-medium", hasError ? "text-rose-700" : check.ready ? "text-emerald-700" : "text-amber-800")}>
              {hasError ? "belgeler birbirini tutmuyor" : check.ready ? "belgeler birbirini tutuyor" : "eksik belge var"}
            </span>{" "}
            · mağaza Net Ciro {money(check.store_net)} (
            {check.store_net_source === "itpos" ? "IT POS" : check.store_net_source === "bi" ? "BI" : check.store_net_source === "daily" ? "günlük dosyalar" : "—"}) · kişi
            toplamı {money(check.persons_sum)}
            {check.top_seller ? ` · top-seller ${check.top_seller}` : ""}
            {daily && daily.days_present > 0 && check.store_net_source !== "daily" ? (
              <>
                {" "}
                · günlük dosyalar {money(daily.store_net)}
                {check.daily_agrees === true ? <span className="font-medium text-emerald-700"> — aynı</span> : null}
                {check.daily_agrees === false ? <span className="font-medium text-rose-700"> — farklı</span> : null}
              </>
            ) : null}
          </summary>
          <div className="mt-2 space-y-2">
            {check.flags.map((f) => (
              <div key={f.text} className={cn("flex items-start gap-1.5 text-xs", f.level === "error" ? "text-rose-700" : f.level === "warn" ? "text-amber-800" : "text-muted-foreground")}>
                {f.level !== "info" ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> : null}
                {f.text}
              </div>
            ))}
            <div className="text-xs text-muted-foreground">
              UPT: IT POS {check.upt_itpos ?? "—"} · BI {check.upt_bi ?? "—"} · Tekli işlem: IT POS {pct(check.single_pct_itpos)} · BI {pct(check.single_pct_bi)} · Kadın denim{" "}
              {check.kadin_denim_units_store ?? "—"} adet · Denim toplam {check.denim_units_store ?? "—"} adet
            </div>
            {daily && daily.days_present > 0 ? (
              <div className="text-xs text-muted-foreground">
                Günlük dosyalar: ay boyunca yüklenen bayi gün sonu dosyalarından yeniden hesaplanan Net Ciro (KDV hariç tutar − Kartuş). {daily.days_present}/
                {daily.days_expected} gün — {daily.upload_days} gün mağazanın günlük yüklemesinden, {daily.archive_days} gün sonradan eklenen dosyalardan.
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1 text-left font-medium">Kişi</th>
                    <th className="py-1 text-right font-medium">Günlük dosyalar</th>
                    <th className="py-1 text-right font-medium">Net ciro (BI)</th>
                    <th className="py-1 text-right font-medium">Net ciro (IT POS)</th>
                    <th className="py-1 text-right font-medium">Bordroda</th>
                    <th className="py-1 text-right font-medium">Denim</th>
                    <th className="py-1 text-right font-medium">Denim dışı</th>
                    <th className="py-1 text-right font-medium">Denim adet KPI / BI</th>
                    <th className="py-1 text-right font-medium">Kadın denim</th>
                    <th className="py-1 text-right font-medium">UPT</th>
                    <th className="py-1 text-right font-medium">Tekli</th>
                    <th className="py-1 pl-2 text-left font-medium">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {check.rows.map((r) => {
                    const err = r.flags.find((f) => f.level === "error");
                    const warn = r.flags.find((f) => f.level === "warn");
                    const info = r.flags.find((f) => f.level === "info");
                    const dailyFlag = r.flags.find((f) => f.level !== "info" && f.text.startsWith("Günlük dosyalar"));
                    const ref = r.net_itpos ?? r.net_bi;
                    const dailySame = !dailyFlag && r.net_daily != null && ref != null && !!daily?.complete;
                    return (
                      <tr key={r.code ?? r.name} className="border-b last:border-0">
                        <td className="py-1">
                          {r.name}
                          {!r.line_id ? <span className="text-muted-foreground"> (bordroda yok)</span> : null}
                        </td>
                        <td
                          className={cn(
                            "py-1 text-right tabular-nums",
                            dailyFlag ? (dailyFlag.level === "error" ? "font-medium text-rose-700" : "text-amber-800") : dailySame ? "text-emerald-700" : ""
                          )}
                        >
                          {money(r.net_daily)}
                        </td>
                        <td className="py-1 text-right tabular-nums">{money(r.net_bi)}</td>
                        <td className="py-1 text-right tabular-nums">{money(r.net_itpos)}</td>
                        <td className="py-1 text-right tabular-nums text-muted-foreground">{money(r.line_total)}</td>
                        <td className="py-1 text-right tabular-nums">{money(r.denim_tl)}</td>
                        <td className="py-1 text-right tabular-nums">{money(r.nd_tl)}</td>
                        <td className="py-1 text-right tabular-nums">
                          {r.denim_units_kpi ?? "—"} / {r.denim_units_bi ?? "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums">{r.kadin_denim_units ?? "—"}</td>
                        <td className="py-1 text-right tabular-nums">{r.upt ?? "—"}</td>
                        <td className="py-1 text-right tabular-nums">{pct(r.single_pct)}</td>
                        <td className={cn("py-1 pl-2", err ? "text-rose-700" : warn ? "text-amber-800" : info ? "text-muted-foreground" : "text-emerald-700")}>
                          {err ? err.text : warn ? warn.text : info ? info.text : r.net_used != null ? "tutuyor" : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      ) : (
        <div className="mt-1 text-xs text-muted-foreground">
          SAP&apos;den alınan üç dosyayı birlikte seçip yükleyin: Çalışan Performans Raporu (PDF), Personel KPI Raporu (Excel) ve IT POS Performans (Excel). Sistem okur,
          karşılaştırır; fark yoksa prim tablosuna tek tuşla aktarır. Ay boyunca yüklenen günlük bayi gün sonu dosyaları da ayrıca toplanır ve bu belgelerle
          karşılaştırılır; eksik günün bayi dosyasını da buradan ekleyebilirsiniz.
        </div>
      )}
    </div>
  );
}
