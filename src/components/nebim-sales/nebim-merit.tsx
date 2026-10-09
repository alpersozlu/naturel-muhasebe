"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  IdCard,
  ImageOff,
  Loader2,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { MeritCardView, MeritInvoiceView, MeritStatus } from "@/server/services/merit/check";
import type { NebimSalesSelection } from "./nebim-filters";

/**
 * Merit %10 Kontrolü (sahibi, 09.10.2026): anlaşmalı otel çalışanına yapılan
 * %10 sepet indirimi gerçekten otel personeline mi yapıldı? Mağaza kartın
 * fotoğrafını çeker; burada fişteki müşteri adı kartla eşleşir. Kartı olmayan
 * fişler kırmızı ve en üstte. Kart fotoğrafları bu kutuya bırakılır.
 */

const TRY = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => TRY.format(n);
const dmy = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

const STATUS: Record<MeritStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  missing: { label: "Kart yok", cls: "bg-rose-50 text-rose-800 ring-rose-200", icon: <ShieldAlert className="h-3.5 w-3.5" /> },
  ok_card: { label: "Kart var", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", icon: <BadgeCheck className="h-3.5 w-3.5" /> },
  ok_no_card: { label: "Kartsız kabul", cls: "bg-sky-50 text-sky-800 ring-sky-200", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  rejected: { label: "Reddedildi", cls: "bg-slate-100 text-slate-700 ring-slate-200", icon: <XCircle className="h-3.5 w-3.5" /> },
  not_required: { label: "Kart aranmaz", cls: "bg-muted text-muted-foreground ring-border", icon: null },
};
const ORDER: Record<MeritStatus, number> = { missing: 0, rejected: 1, ok_no_card: 2, ok_card: 3, not_required: 4 };

type Tab = "all" | "missing" | "ok" | "other";

function fileToBase64(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(new Error("dosya okunamadı"));
    r.readAsDataURL(f);
  });
}
const MIME_OK = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export function NebimMerit({ filters }: { filters: NebimSalesSelection }) {
  const utils = trpc.useUtils();
  const input = { store_id: filters.storeId || undefined, date_from: filters.dateFrom || undefined, date_to: filters.dateTo || undefined };
  const q = trpc.merit.check.useQuery(input, { refetchOnWindowFocus: false });
  const refresh = () => void utils.merit.check.invalidate();
  const confirm = useConfirm();

  const upload = trpc.merit.uploadCards.useMutation();
  const read = trpc.merit.readCard.useMutation();
  const link = trpc.merit.link.useMutation({ onSuccess: () => { toast.success("Fiş karta bağlandı"); refresh(); }, onError: (e) => toast.error(e.message) });
  const decide = trpc.merit.decide.useMutation({ onSuccess: () => { toast.success("Karar kaydedildi"); refresh(); }, onError: (e) => toast.error(e.message) });
  const clear = trpc.merit.clear.useMutation({ onSuccess: () => { toast.success("Karar geri alındı"); refresh(); }, onError: (e) => toast.error(e.message) });
  const del = trpc.merit.deleteCard.useMutation({ onSuccess: () => { toast.success("Kart kaldırıldı"); refresh(); }, onError: (e) => toast.error(e.message) });
  const update = trpc.merit.updateCard.useMutation({ onSuccess: () => { toast.success("Kart güncellendi"); refresh(); }, onError: (e) => toast.error(e.message) });

  const [tab, setTab] = useState<Tab>("all");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const [picker, setPicker] = useState<MeritInvoiceView | null>(null);
  const [decision, setDecision] = useState<{ inv: MeritInvoiceView; kind: "no_card_ok" | "rejected" } | null>(null);
  const [editing, setEditing] = useState<MeritCardView | null>(null);
  const [cardsOpen, setCardsOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const ingest = async (list: FileList | File[]) => {
    const files = Array.from(list).filter((f) => MIME_OK.has(f.type));
    if (files.length === 0) {
      toast.error("Yalnız fotoğraf (JPG/PNG/HEIC) yüklenebilir");
      return;
    }
    setProgress({ done: 0, total: files.length });
    try {
      const payload = await Promise.all(files.map(async (f) => ({ name: f.name, mime_type: f.type as "image/jpeg", base64: await fileToBase64(f) })));
      const r = await upload.mutateAsync({ files: payload });
      if (r.skipped.length) toast.info(`${r.skipped.length} dosya atlandı: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}`);
      let done = 0;
      let unreadable = 0;
      for (const id of r.created) {
        const o = await read.mutateAsync({ id });
        if (!o.is_card || o.ocr_status !== "done") unreadable += 1;
        done += 1;
        setProgress({ done, total: r.created.length });
      }
      toast.success(`${r.created.length} kart yüklendi${unreadable ? ` · ${unreadable} tanesi okunamadı, kartlar listesinden düzeltin` : ""}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Yükleme başarısız");
    } finally {
      setProgress(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const data = q.data;
  const rows = useMemo(() => {
    if (!data) return [] as MeritInvoiceView[];
    const list = [...data.invoices].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.invoice_date.localeCompare(a.invoice_date));
    if (tab === "missing") return list.filter((i) => i.status === "missing");
    if (tab === "ok") return list.filter((i) => i.status === "ok_card");
    if (tab === "other") return list.filter((i) => i.status === "ok_no_card" || i.status === "rejected" || i.status === "not_required");
    return list;
  }, [data, tab]);

  if (q.isLoading || !data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
          Merit fişleri okunuyor…
        </CardContent>
      </Card>
    );
  }
  const k = data.kpi;
  const busy = !!progress;

  return (
    <Card
      className={cn("overflow-hidden", drag && "ring-2 ring-sky-300")}
      onDragEnter={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { if (!e.dataTransfer.types.includes("Files")) return; e.preventDefault(); setDrag(false); void ingest(e.dataTransfer.files); }}
    >
      <CardContent className="p-0">
        {/* Başlık + yükleme */}
        <div className="flex flex-wrap items-start gap-4 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <IdCard className="h-5 w-5 text-muted-foreground" />
              Merit %10 Kontrolü
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Otel personeline yapılan %10 indirim doğru kişiye mi? Fişteki müşteri adı, mağazanın çektiği personel kartıyla eşleştirilir.
              Kart zorunlu: Girne baştan beri · Lefkoşa 08.10.2026'dan itibaren.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileInput} type="file" accept="image/*,.heic" multiple hidden onChange={(e) => e.target.files && void ingest(e.target.files)} />
            <Button size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {busy ? `Okunuyor ${progress!.done}/${progress!.total}` : "Kart fotoğrafı yükle"}
            </Button>
          </div>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Merit fişi" value={String(k.invoices)} sub={`${money(k.total)} ₺ satış`} />
          <Kpi label="Kartı olmayan" value={String(k.missing)} tone={k.missing ? "text-rose-700" : "text-emerald-700"} sub={k.missing ? "kontrol edilmeli" : "temiz"} />
          <Kpi label="Kartlı" value={String(k.with_card)} tone="text-emerald-700" />
          <Kpi label="Kartsız kabul" value={String(k.accepted_no_card)} />
          <Kpi
            label="Diğer anlaşmalı"
            value={String(Object.values(k.other_hotels).reduce((a, b) => a + b, 0))}
            sub={Object.entries(k.other_hotels).map(([h, n]) => `${h} ${n}`).join(" · ") || "kart programı yok"}
          />
          <Kpi label="İndirim toplamı" value={`${money(k.discount_total)} ₺`} sub="satır + dip iskonto" />
        </div>

        {/* Sekmeler */}
        <div className="flex flex-wrap items-center gap-1 border-b px-5 py-2 text-sm">
          {(
            [
              ["all", `Hepsi (${k.invoices})`],
              ["missing", `Kart yok (${k.missing})`],
              ["ok", `Kart var (${k.with_card})`],
              ["other", `Diğer (${k.accepted_no_card + k.rejected + k.not_required + Object.values(k.other_hotels).reduce((a, b) => a + b, 0)})`],
            ] as Array<[Tab, string]>
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn("rounded-full px-3 py-1 transition-colors", tab === t ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted", t === "missing" && tab !== t && k.missing > 0 && "text-rose-700")}
            >
              {label}
            </button>
          ))}
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">{drag ? "Bırakın — kartlar yüklenecek" : "Fotoğrafları bu kutuya sürükleyip bırakabilirsiniz"}</span>
        </div>

        {/* Fişler */}
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            {tab === "missing" ? "Kartı olmayan Merit fişi yok." : "Bu dönemde Merit indirimli fiş yok."}
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((inv) => (
              <InvoiceRow
                key={inv.invoice_ref}
                inv={inv}
                onPick={() => setPicker(inv)}
                onAccept={() => setDecision({ inv, kind: "no_card_ok" })}
                onReject={() => setDecision({ inv, kind: "rejected" })}
                onClear={async () => {
                  if (await confirm({ title: "Karar geri alınsın mı?", description: `${inv.invoice_ref} yeniden otomatik eşleşmeye döner.`, confirmLabel: "Geri al" })) clear.mutate({ invoice_ref: inv.invoice_ref });
                }}
              />
            ))}
          </ul>
        )}

        {/* Kartlar */}
        <div className="border-t">
          <button type="button" onClick={() => setCardsOpen((o) => !o)} className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-medium hover:bg-muted/40">
            {cardsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Yüklü kartlar ({data.cards.length})
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {data.cards.filter((c) => c.linked === 0 && c.is_card && c.ocr_status === "done").length} tanesi hiçbir fişle eşleşmedi
              {data.cards.some((c) => c.ocr_status !== "done" || !c.is_card) ? ` · ${data.cards.filter((c) => c.ocr_status !== "done" || !c.is_card).length} okunamadı` : ""}
            </span>
          </button>
          {cardsOpen ? (
            <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {data.cards.map((c) => (
                <CardTile
                  key={c.id}
                  c={c}
                  onRead={() => read.mutate({ id: c.id }, { onSuccess: refresh })}
                  onEdit={() => setEditing(c)}
                  onDelete={async () => {
                    if (await confirm({ title: "Kart kaldırılsın mı?", description: `${c.full_name ?? c.source_name ?? "Kart"} listeden çıkar; ona bağlı elle kararlar silinir.`, confirmLabel: "Kaldır" })) del.mutate({ id: c.id });
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      </CardContent>

      {picker ? (
        <CardPicker
          inv={picker}
          cards={data.cards.filter((c) => c.is_card && c.ocr_status === "done")}
          onClose={() => setPicker(null)}
          onPick={(cardId) => { link.mutate({ invoice_ref: picker.invoice_ref, card_id: cardId }); setPicker(null); }}
        />
      ) : null}
      {decision ? (
        <DecisionDialog
          inv={decision.inv}
          kind={decision.kind}
          onClose={() => setDecision(null)}
          onSave={(note) => { decide.mutate({ invoice_ref: decision.inv.invoice_ref, decision: decision.kind, note }); setDecision(null); }}
        />
      ) : null}
      {editing ? (
        <EditCardDialog
          c={editing}
          onClose={() => setEditing(null)}
          onSave={(v) => { update.mutate({ id: editing.id, ...v }); setEditing(null); }}
        />
      ) : null}
    </Card>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-xl font-semibold tabular-nums tracking-tight", tone)}>{value}</div>
      {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function StatusBadge({ s }: { s: MeritStatus }) {
  const m = STATUS[s];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", m.cls)}>
      {m.icon}
      {m.label}
    </span>
  );
}

function Thumb({ url, size = 44, alt }: { url: string | null; size?: number; alt: string }) {
  if (!url)
    return (
      <div className="flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" style={{ width: size, height: size }}>
        <ImageOff className="h-4 w-4" />
      </div>
    );
  return (
    <a href={url} target="_blank" rel="noreferrer" className="shrink-0" title="Kartı büyük aç">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} className="rounded-md object-cover ring-1 ring-border" style={{ width: size, height: size }} loading="lazy" />
    </a>
  );
}

function InvoiceRow({ inv, onPick, onAccept, onReject, onClear }: { inv: MeritInvoiceView; onPick: () => void; onAccept: () => void; onReject: () => void; onClear: () => void }) {
  const missing = inv.status === "missing";
  const decided = inv.match === "manual" || inv.status === "ok_no_card" || inv.status === "rejected";
  return (
    <li className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm", missing && "border-l-4 border-rose-500 bg-rose-50/40")}>
      <div className="w-24 shrink-0 tabular-nums text-muted-foreground">{dmy(inv.invoice_date)}</div>
      <div className="w-32 shrink-0 truncate text-xs text-muted-foreground" title={inv.invoice_ref}>
        {inv.store_name}
        <div className="truncate">{inv.invoice_ref}</div>
      </div>
      <div className="min-w-[180px] flex-1">
        <div className="flex items-center gap-2 font-medium">
          {inv.customer_name ?? <span className="text-muted-foreground">müşteri adı yok</span>}
          {inv.hotel !== "Merit" ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{inv.hotel}</span> : null}
        </div>
        <div className="truncate text-xs text-muted-foreground" title={inv.note ?? ""}>
          {inv.salesperson_name ? `${inv.salesperson_name} · ` : ""}
          {inv.lines} satır · {inv.note ?? "—"}
        </div>
      </div>
      <div className="w-36 shrink-0 text-right tabular-nums">
        <div>{money(inv.total)} ₺</div>
        <div className="text-xs text-rose-700">−{money(inv.discount)}</div>
      </div>
      <div className="flex w-64 shrink-0 items-center gap-2">
        {inv.card ? (
          <>
            <Thumb url={inv.card.url} alt={inv.card.full_name ?? "kart"} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{inv.card.full_name}</div>
              <div className="text-xs text-muted-foreground">
                {inv.card.id_no ? `Sicil ${inv.card.id_no} · ` : ""}
                {inv.card.company ?? "Merit"}
                {inv.match === "auto" && inv.card.score != null ? ` · otomatik %${Math.round(inv.card.score * 100)}` : inv.match === "manual" ? " · elle bağlandı" : ""}
              </div>
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground">
            {inv.status === "ok_no_card" || inv.status === "rejected"
              ? (inv.review_note ?? "—")
              : inv.suggestions.length
                ? `Benzer kart: ${inv.suggestions[0]!.full_name} (%${Math.round(inv.suggestions[0]!.score * 100)})`
                : missing
                  ? "Kart fotoğrafı yok"
                  : inv.hotel !== "Merit"
                    ? `${inv.hotel} — kart programı yok`
                    : "Kural öncesi — kart aranmaz"}
          </div>
        )}
      </div>
      <div className="w-28 shrink-0">
        <StatusBadge s={inv.status} />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {decided ? (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onClear} title="Kararı geri al">
            <RotateCcw className="mr-1 h-3 w-3" />
            Geri al
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onPick}>
              <IdCard className="mr-1 h-3 w-3" />
              {inv.card ? "Değiştir" : "Kart seç"}
            </Button>
            {inv.status !== "ok_card" ? (
              <>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onAccept}>
                  Kartsız kabul
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-rose-700" onClick={onReject}>
                  Reddet
                </Button>
              </>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

function CardTile({ c, onRead, onEdit, onDelete }: { c: MeritCardView; onRead: () => void; onEdit: () => void; onDelete: () => void }) {
  const bad = c.ocr_status !== "done" || !c.is_card;
  return (
    <div className={cn("rounded-lg border bg-card p-2 text-xs", bad && "border-amber-300 bg-amber-50/40")}>
      <div className="flex items-start gap-2">
        <Thumb url={c.url} size={56} alt={c.full_name ?? "kart"} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{c.full_name ?? <span className="text-muted-foreground">{c.ocr_status === "pending" ? "okunmadı" : "ad okunamadı"}</span>}</div>
          <div className="truncate text-muted-foreground">
            {c.id_no ? `Sicil ${c.id_no}` : ""}
            {c.company ? ` · ${c.company}` : ""}
          </div>
          <div className="truncate text-muted-foreground">{c.photo_date ? `çekim ${dmy(c.photo_date)}` : (c.source_name ?? "")}</div>
          <div className={cn("mt-0.5", c.linked ? "text-emerald-700" : "text-muted-foreground")}>
            {c.linked
              ? `${c.linked} fişle eşleşti`
              : c.other == null
                ? "eşleşme yok"
                : c.other.count === 0
                  ? "Merit fişi yok · bu adla hiç alışveriş yok (Ocak 2026'dan beri)"
                  : `Merit fişi yok · bu adla ${c.other.count} fiş var, Merit notu yazılmamış (son ${dmy(c.other.last_date!)})`}
          </div>
          {bad ? <div className="mt-0.5 text-amber-800">{c.ocr_error ?? "okuma bekliyor"}</div> : null}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1">
        {bad ? (
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={onRead}>
            <ScanLine className="mr-1 h-3 w-3" />
            Oku
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onEdit}>
          Düzenle
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-[11px] text-muted-foreground" onClick={onDelete} title="Kaldır">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function CardPicker({ inv, cards, onClose, onPick }: { inv: MeritInvoiceView; cards: MeritCardView[]; onClose: () => void; onPick: (id: string) => void }) {
  const [qs, setQs] = useState("");
  const scoreOf = new Map(inv.suggestions.map((s) => [s.id, s.score]));
  const list = cards
    .filter((c) => !qs || (c.full_name ?? "").toLocaleLowerCase("tr").includes(qs.toLocaleLowerCase("tr")) || (c.id_no ?? "").includes(qs))
    .sort((a, b) => (scoreOf.get(b.id) ?? 0) - (scoreOf.get(a.id) ?? 0) || (a.full_name ?? "").localeCompare(b.full_name ?? "", "tr"));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Kart seç — {inv.customer_name ?? inv.invoice_ref}</DialogTitle>
          <DialogDescription>
            {dmy(inv.invoice_date)} · {inv.store_name} · {money(inv.total)} ₺. Fişteki ada en çok benzeyen kartlar üstte.
          </DialogDescription>
        </DialogHeader>
        <Input autoFocus placeholder="Ad ya da sicil no ara" value={qs} onChange={(e) => setQs(e.target.value)} />
        <ul className="max-h-[50vh] divide-y overflow-y-auto">
          {list.map((c) => {
            const s = scoreOf.get(c.id);
            return (
              <li key={c.id}>
                <button type="button" onClick={() => onPick(c.id)} className="flex w-full items-center gap-3 px-1 py-2 text-left hover:bg-muted/50">
                  <Thumb url={c.url} size={40} alt={c.full_name ?? "kart"} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.full_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.id_no ? `Sicil ${c.id_no} · ` : ""}
                      {c.company ?? "Merit"}
                      {c.photo_date ? ` · çekim ${dmy(c.photo_date)}` : ""}
                      {c.linked ? ` · ${c.linked} fişle eşli` : ""}
                    </div>
                  </div>
                  {s != null ? <span className={cn("text-xs tabular-nums", s >= 0.8 ? "text-emerald-700" : "text-muted-foreground")}>%{Math.round(s * 100)} benzer</span> : null}
                </button>
              </li>
            );
          })}
          {list.length === 0 ? <li className="py-6 text-center text-sm text-muted-foreground">Kart bulunamadı — önce fotoğrafı yükleyin.</li> : null}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecisionDialog({ inv, kind, onClose, onSave }: { inv: MeritInvoiceView; kind: "no_card_ok" | "rejected"; onClose: () => void; onSave: (note: string) => void }) {
  const [note, setNote] = useState("");
  const reject = kind === "rejected";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{reject ? "İndirimi reddet" : "Kartsız kabul et"}</DialogTitle>
          <DialogDescription>
            {inv.customer_name ?? inv.invoice_ref} · {dmy(inv.invoice_date)} · {inv.store_name}.{" "}
            {reject ? "Bu %10 indirim otel personeline yapılmamış sayılır; satıcıdan açıklama istenir." : "Kart fotoğrafı yok ama indirim hak edilmiş (kart sonradan görüldü vb.)."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Not (zorunlu — kim, neden)</Label>
          <Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={reject ? "Örn. müşteri otel çalışanı değil, Ayşe'ye soruldu" : "Örn. kart WhatsApp'tan geldi, 10.10"} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant={reject ? "destructive" : "default"} disabled={note.trim().length < 3} onClick={() => onSave(note.trim())}>
            {reject ? "Reddet" : "Kabul et"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditCardDialog({ c, onClose, onSave }: { c: MeritCardView; onClose: () => void; onSave: (v: { full_name?: string; id_no?: string | null; company?: string | null; is_card?: boolean }) => void }) {
  const [name, setName] = useState(c.full_name ?? "");
  const [idNo, setIdNo] = useState(c.id_no ?? "");
  const [company, setCompany] = useState(c.company ?? "");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Kartı düzenle</DialogTitle>
          <DialogDescription>Okuma hatalıysa karttaki adı aynen yazın; eşleştirme bu ada göre yapılır.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-3">
          <Thumb url={c.url} size={96} alt={c.full_name ?? "kart"} />
          <div className="flex-1 space-y-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Ad Soyad (karttaki gibi)</Label>
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Sicil no</Label>
                <Input value={idNo} onChange={(e) => setIdNo(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Kurum</Label>
                <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Merit Park" />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={name.trim().length < 2} onClick={() => onSave({ full_name: name.trim(), id_no: idNo.trim() || null, company: company.trim() || null, is_card: true })}>
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
