"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, Clock, IdCard, ImageOff, Loader2, RefreshCw, Trash2, TriangleAlert, Upload } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { inferFileMime } from "@/lib/file-mime";
import type { StoreMatchStatus } from "@/server/services/merit/store-match";

/**
 * OTEL ANLAŞMASI (Merit %10) — SADECE Derimod mağazalarında görünür.
 * Anlaşmalı otel personeline sepette %10 indirim yapılırken personel kimlik
 * kartının fotoğrafı çekilir ve buraya yüklenir. Sistem kartı okur, NEBİM'de
 * o adla kesilmiş fişi bulur ve fişte "%10 Merit" notunun yazılı olduğunu
 * doğrular. Köprü saatlik çalışır: satıştan hemen sonra "henüz fiş yok"
 * normaldir, sonra "Yeniden kontrol et".
 */

const TRY = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");
const TARGET_MAX = 3 * 1024 * 1024; // Vercel gövde sınırı — base64 öncesi ~3 MB

const STATUS: Record<StoreMatchStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  confirmed: { label: "Doğrulandı", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", icon: <BadgeCheck className="h-3.5 w-3.5" /> },
  no_hotel_note: { label: "Fiş var, Merit notu yok", cls: "bg-amber-50 text-amber-900 ring-amber-200", icon: <TriangleAlert className="h-3.5 w-3.5" /> },
  not_found: { label: "Henüz fiş yok", cls: "bg-muted text-muted-foreground ring-border", icon: <Clock className="h-3.5 w-3.5" /> },
  unreadable: { label: "Kart okunamadı", cls: "bg-rose-50 text-rose-800 ring-rose-200", icon: <ImageOff className="h-3.5 w-3.5" /> },
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      const i = s.indexOf(",");
      res(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => rej(new Error("dosya okunamadı"));
    r.readAsDataURL(blob);
  });
}

/** Telefon fotoğrafı 3–8 MB gelir; 2000 px JPEG'e küçült (OCR için yeterli). HEIC sunucuda çevrilir. */
async function shrink(file: File): Promise<{ blob: Blob; mime: string }> {
  const mime = inferFileMime(file);
  const canvasOk = mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
  if (!canvasOk || file.size <= TARGET_MAX) return { blob: file, mime };
  const bmp = await createImageBitmap(file);
  const max = 2000;
  const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * r);
  canvas.height = Math.round(bmp.height * r);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { blob: file, mime };
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.86));
  return blob ? { blob, mime: "image/jpeg" } : { blob: file, mime };
}

export function HotelCardUpload({ storeId }: { storeId: string }) {
  const utils = trpc.useUtils();
  const q = trpc.merit.storeCards.useQuery({ store_id: storeId }, { enabled: !!storeId, refetchOnWindowFocus: false });
  const upload = trpc.merit.storeUpload.useMutation();
  const read = trpc.merit.storeRead.useMutation();
  const del = trpc.merit.storeDelete.useMutation({
    onSuccess: () => {
      toast.success("Fotoğraf kaldırıldı");
      void utils.merit.storeCards.invalidate({ store_id: storeId });
    },
    onError: (e) => toast.error(e.message),
  });
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [drag, setDrag] = useState(false);

  const ingest = async (list: FileList | File[]) => {
    const files = Array.from(list).slice(0, 10);
    if (files.length === 0) return;
    setProgress({ done: 0, total: files.length });
    try {
      const payload = [];
      for (const f of files) {
        const { blob, mime } = await shrink(f);
        if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(mime)) {
          toast.error(`${f.name}: yalnız fotoğraf yüklenebilir`);
          continue;
        }
        payload.push({ name: f.name, mime_type: mime as "image/jpeg", base64: await blobToBase64(blob) });
      }
      if (payload.length === 0) return;
      const r = await upload.mutateAsync({ store_id: storeId, files: payload });
      if (r.skipped.length) toast.info(`${r.skipped.map((s) => `${s.name}: ${s.reason}`).join(", ")}`);
      let done = 0;
      for (const id of r.created) {
        const o = await read.mutateAsync({ id });
        done += 1;
        setProgress({ done, total: r.created.length });
        if (!o.is_card || !o.full_name) toast.error(`${o.full_name ?? "Fotoğraf"}: kart okunamadı — daha yakından, düz çekin`);
        else if (o.match.status === "confirmed") toast.success(`${o.full_name}: fiş bulundu, %10 Merit notu var ✓`);
        else if (o.match.status === "no_hotel_note") toast.warning(`${o.full_name}: fiş var ama Merit notu yazılmamış`);
        else toast.info(`${o.full_name}: kart okundu, NEBİM'de henüz fiş yok (aktarım saatlik)`);
      }
      void utils.merit.storeCards.invalidate({ store_id: storeId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Yükleme başarısız");
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  };

  const busy = !!progress;
  const cards = q.data?.cards ?? [];
  const last = q.data?.nebim_last_ingest_at ? new Date(q.data.nebim_last_ingest_at) : null;
  const waiting = cards.filter((c) => c.match.status === "not_found").length;

  return (
    <Card
      className={cn("sm:col-span-2 lg:col-span-3", drag && "ring-2 ring-sky-300")}
      onDragEnter={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { if (!e.dataTransfer.types.includes("Files")) return; e.preventDefault(); setDrag(false); void ingest(e.dataTransfer.files); }}
    >
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
            <IdCard className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Otel Anlaşması — Personel Kartı (%10)</div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Merit personeline %10 indirim yaparken kimlik kartının fotoğrafını çekip buraya yükleyin. Sistem kartı okur, NEBİM'de o isme kesilen
              fişi bulur ve fişte &quot;%10 Merit&quot; notunu doğrular. Fişi NEBİM&apos;e açıklama olarak <b>%10 Merit</b> yazmayı unutmayın.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <input ref={input} type="file" accept="image/*,.heic" multiple capture="environment" hidden onChange={(e) => e.target.files && void ingest(e.target.files)} />
            <Button size="sm" onClick={() => input.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {busy ? `Okunuyor ${progress!.done}/${progress!.total}` : "Kart fotoğrafı yükle"}
            </Button>
            {waiting > 0 ? (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void q.refetch()} disabled={q.isFetching}>
                <RefreshCw className={cn("mr-1 h-3 w-3", q.isFetching && "animate-spin")} />
                Yeniden kontrol et ({waiting} bekliyor)
              </Button>
            ) : null}
          </div>
        </div>

        {q.isLoading ? (
          <div className="mt-4 text-sm text-muted-foreground">Kartlar yükleniyor…</div>
        ) : cards.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
            {drag ? "Bırakın — fotoğraf yüklenecek" : "Henüz kart yüklenmedi. Fotoğrafı buraya sürükleyin ya da düğmeye basın."}
          </div>
        ) : (
          <ul className="mt-4 divide-y rounded-lg border">
            {cards.map((c) => {
              const st = STATUS[c.match.status];
              const inv = c.match.invoices[0];
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer" className="shrink-0" title="Kartı büyük aç">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.url} alt={c.full_name ?? "kart"} className="h-11 w-11 rounded-md object-cover ring-1 ring-border" loading="lazy" />
                    </a>
                  ) : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <ImageOff className="h-4 w-4" />
                    </div>
                  )}
                  <div className="min-w-[160px] flex-1">
                    <div className="font-medium">{c.full_name ?? <span className="text-muted-foreground">{c.ocr_status === "pending" ? "okunuyor…" : "ad okunamadı"}</span>}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.id_no ? `Sicil ${c.id_no} · ` : ""}
                      {c.company ?? "Merit"} · yüklendi {dmy(c.uploaded_at)}
                    </div>
                  </div>
                  <div className="min-w-[220px] flex-1 text-xs text-muted-foreground">
                    {c.match.status === "confirmed" && inv ? (
                      <>
                        Fiş {dmy(inv.invoice_date)} · {TRY.format(inv.total)} ₺{inv.discount_pct != null ? ` · %${inv.discount_pct}` : ""} · not &quot;{inv.note}&quot;
                      </>
                    ) : c.match.status === "no_hotel_note" && inv ? (
                      <>
                        Bu adla {dmy(inv.invoice_date)} fişi var ({TRY.format(inv.total)} ₺{inv.discount_pct != null ? ` · %${inv.discount_pct}` : ""}) ama açıklamada Merit yazmıyor — kasada düzeltin.
                      </>
                    ) : c.match.status === "not_found" ? (
                      <>
                        {dmy(c.match.from)} – {dmy(c.match.to)} arası bu adla fiş yok.
                        {last ? ` NEBİM son aktarım ${last.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" })}.` : ""}
                      </>
                    ) : (
                      c.ocr_error ?? "Fotoğraf net değil; kartı düz ve yakından çekin."
                    )}
                  </div>
                  <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", st.cls)}>
                    {st.icon}
                    {st.label}
                  </span>
                  <Button size="sm" variant="ghost" className="h-7 w-7 shrink-0 p-0 text-muted-foreground" title="Kaldır" onClick={() => del.mutate({ id: c.id })} disabled={del.isPending}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
