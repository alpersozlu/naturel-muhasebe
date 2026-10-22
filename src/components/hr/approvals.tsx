"use client";

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { toast } from "sonner";
import { Check, ChevronRight, Loader2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TONE_CLS, dayLong, dayMonth, daysLeftText, hours, num, range } from "./format";
import { Notice } from "./staff-home";
import { Avatar } from "./avatar";

type Data = inferRouterOutputs<AppRouter>["hr"]["approvals"];
type Item = Data["items"][number];

const LEAVE_LABEL: Record<string, string> = {
  annual: "Yıllık izin",
  lieu: "Hak günü",
  sick: "Hastalık izni",
  bereavement: "Vefat izni",
  unpaid: "Ücretsiz izin",
};
const REASON_LABEL: Record<string, string> = {
  opening_closing: "Açılış ve kapanış",
  stock_count: "Sayım",
  goods_receipt: "Mal kabul / ürün indirme",
  busy: "Yoğunluk",
  missed_break: "Molasını kullanamadı",
  other: "Başka sebep",
};

/**
 * MÜDÜR / SAHİBİ ONAY EKRANI. Üstte bekleyen talepler — dokununca İNCELEME
 * ekranı açılır (kim, ne, onaylarsanız ne olur, onay sırası, Reddet / Onayla);
 * altta ekip: kimin hak günü açık, kim gecikti.
 */
export function HrApprovals() {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const q = trpc.hr.approvals.useQuery({ all });
  if (q.isLoading) return <Loader2 className="mx-auto mt-20 h-6 w-6 animate-spin text-muted-foreground" />;
  if (q.error || !q.data) return <Notice tone="red" title="Açılamadı" text={q.error?.message ?? ""} />;
  const { items, team } = q.data;
  const current = items.find((it) => `${it.type}-${it.id}` === open);
  if (current) return <RequestDetail it={current} onClose={() => setOpen(null)} />;
  const late = team.flatMap((t) => t.summary.lieu.credits.filter((c) => c.state === "warn" || c.state === "overdue").map((c) => ({ ...c, who: t.employee })));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Onaylar</h1>
        <p className="text-sm text-muted-foreground">
          Onaylanan pazar / bayram bildirimi kişiye otomatik 1 hak günü ekler.{" "}
          {q.data.isAdmin ? "Personelin taleplerini müdürü, müdürlerin taleplerini siz onaylarsınız." : "Müdür olarak kendi talepleriniz yöneticiye gider."}
        </p>
      </div>

      {q.data.isAdmin && (
        <label className="flex items-center gap-2 rounded-xl border bg-white p-3 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Müdür onayında bekleyenleri de göster
          {!all && q.data.atManagers > 0 && <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs">{q.data.atManagers} talep müdürlerde</span>}
        </label>
      )}

      {late.length > 0 && (
        <div className={cn("rounded-2xl border-2 p-4", TONE_CLS.red)}>
          <div className="font-semibold">İzin gününü kullanmamış personel</div>
          <ul className="mt-2 space-y-1 text-sm">
            {late.map((c) => (
              <li key={c.id}>
                <b>{c.who.name}</b> ({c.who.store}) — {dayMonth(c.date)} {c.kind === "holiday" ? "bayramı" : "pazarı"}: son gün {dayLong(c.deadline)}, {daysLeftText(c.daysLeft)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Bekleyen talepler ({items.length})</h2>
        {items.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Bekleyen talep yok. 🎉</p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <ApprovalRow key={`${it.type}-${it.id}`} it={it} onOpen={() => setOpen(`${it.type}-${it.id}`)} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Ekip</h2>
        <div className="overflow-x-auto rounded-2xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">Personel</th>
                <th className="p-2 text-right">Yıllık izin</th>
                <th className="p-2 text-right">Hak günü</th>
                <th className="p-2 text-right">Bu ay mesai</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {team.map(({ employee, summary: s }) => {
                const worst = s.lieu.credits.find((c) => c.state === "overdue") ?? s.lieu.credits.find((c) => c.state === "warn");
                return (
                  <tr key={employee.id}>
                    <td className="p-2">
                      <div className="font-medium">
                        {employee.name}
                        {employee.manager && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-normal">Müdür</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {employee.brand} {employee.store}
                      </div>
                    </td>
                    <td className={cn("p-2 text-right", s.annual.whole < 0 && "text-red-700")}>{s.annual.known ? `${s.annual.whole} gün` : "giriş tarihi yok"}</td>
                    <td className={cn("p-2 text-right", worst && (worst.tone === "red" ? "font-semibold text-red-700" : "text-orange-700"))}>
                      {num(s.lieu.balance)} gün
                    </td>
                    <td className="p-2 text-right">{hours(s.overtimeMonth.approvedMinutes)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Talebin tek satırlık özeti — liste ve inceleme ekranı aynı sözcükleri kullanır. */
function describe(it: Item) {
  if (it.type === "worked") {
    return {
      screen: "Pazar / bayram bildirimi",
      verb: it.kind === "holiday" ? "bayram günü çalıştığını bildirdi" : "pazar günü çalıştığını bildirdi",
      title: it.kind === "holiday" ? "Bayram çalıştı" : "Pazar çalıştı",
      detail: dayLong(it.date),
      flag: null as string | null,
    };
  }
  if (it.type === "leave") {
    return {
      screen: "İzin talebi",
      verb: `${(LEAVE_LABEL[it.kind] ?? "izin").toLocaleLowerCase("tr-TR")} istiyor`,
      title: LEAVE_LABEL[it.kind] ?? "İzin",
      detail: `${range(it.start, it.end)} · ${num(it.days)} gün`,
      flag: it.negative ? "Yıllık izni yetmiyor — onaylanırsa bakiye eksiye düşer" : null,
    };
  }
  return {
    screen: it.restDay ? "Pazar / bayram mesaisi" : "Mesai talebi",
    verb: "mesai yazdı",
    title: `${it.restDay ? "Pazar / bayram mesaisi (×2)" : "Mesai"} · ${REASON_LABEL[it.reason] ?? it.reason}`,
    detail: `${dayLong(it.date)} · ${hours(it.minutes)}`,
    flag: it.long ? "Uzun mesai — kontrol edin" : null,
  };
}

function useDecide(onDone?: () => void) {
  const utils = trpc.useUtils();
  return trpc.hr.decide.useMutation({
    onSuccess: (r) => {
      toast.success(r.approved ? "Onaylandı" : "Reddedildi");
      void utils.hr.approvals.invalidate();
      void utils.hr.me.invalidate();
      onDone?.();
    },
    onError: (e) => toast.error(e.message),
  });
}

const ManagerTag = () => <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-normal">Müdür</span>;

function ApprovalRow({ it, onOpen }: { it: Item; onOpen: () => void }) {
  const m = useDecide();
  const d = describe(it);
  return (
    <li className="rounded-2xl border bg-white">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 p-4 text-left">
        <Avatar name={it.employee.name} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {it.employee.name} <span className="font-normal text-muted-foreground">· {it.employee.store}</span>
            {it.employee.manager && <ManagerTag />}
          </div>
          <div>{d.title}</div>
          <div className="text-sm text-muted-foreground">{d.detail}</div>
          {d.flag && <div className="mt-1 inline-block rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">{d.flag}</div>}
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </button>
      <div className="flex gap-2 border-t px-4 py-2.5">
        <Button variant="ghost" className="flex-1" onClick={onOpen}>
          İncele
        </Button>
        <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={m.isPending} onClick={() => m.mutate({ type: it.type, id: it.id, approve: true })}>
          <Check /> Hızlı onay
        </Button>
      </div>
    </li>
  );
}

const when = (d: Date) =>
  new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Nicosia", day: "numeric", month: "long", weekday: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(d));

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

/** "Onaylarsanız ne olur" — kararı kolaylaştıran bakiye satırları. */
function Effects({ it }: { it: Item }) {
  const s = it.summary;
  const lines: Array<{ text: React.ReactNode; warn?: boolean }> = [];
  if (it.type === "worked") {
    lines.push({ text: <>+1 hak günü eklenir. {it.employee.name.split(" ")[0]} bu günü en geç <b>{dayLong(it.deadline)}</b> gününe kadar kullanmalı.</> });
    if (s) lines.push({ text: <>Şu an açık hak günü: <b>{num(s.lieu.balance)}</b> → <b>{num(s.lieu.balance + 1)}</b></> });
  } else if (it.type === "leave" && s) {
    if (it.kind === "annual") {
      const after = Math.floor(s.annual.remaining - it.days + 1e-9);
      lines.push({ text: <>Yıllık izin: <b>{s.annual.whole} gün</b> → <b>{after} gün</b></>, warn: after < 0 });
    } else if (it.kind === "lieu") {
      lines.push({ text: <>Açık hak günü: <b>{num(s.lieu.balance)}</b> → <b>{num(Math.max(0, s.lieu.balance - it.days))}</b> (yıllık izinden düşmez)</> });
    } else if (it.kind === "sick") {
      lines.push({ text: <>Bu yıl hastalık izni: <b>{num(s.sick.used)}</b> → <b>{num(s.sick.used + it.days)}</b> / {s.sick.allowance} gün</>, warn: s.sick.used + it.days > s.sick.allowance });
    } else if (it.kind === "unpaid") {
      lines.push({ text: <>Ücretsiz izin: {num(it.days)} gün maaştan kesilir.</> });
    } else {
      lines.push({ text: <>Vefat izni yıllık izinden düşmez.</> });
    }
  } else if (it.type === "overtime" && s) {
    lines.push({ text: <>Bu ay onaylı mesai: <b>{hours(s.overtimeMonth.approvedMinutes)}</b> → <b>{hours(s.overtimeMonth.approvedMinutes + it.minutes)}</b></> });
    if (it.restDay) lines.push({ text: <>Pazar / bayram mesaisi — <b>2 kat</b> ödenir.</> });
    if (it.long) lines.push({ text: <>4 saatten uzun mesai — saatleri kontrol edin.</>, warn: true });
  }
  if (!lines.length) return null;
  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="mb-1 text-sm font-semibold">Onaylarsanız</div>
      <ul className="space-y-1.5 text-sm">
        {lines.map((l, i) => (
          <li key={i} className={cn(l.warn && "font-medium text-red-700")}>
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * TALEP İNCELEME EKRANI (Kolay İK'nın talep sayfasından daha açık): kim ne
 * istedi, kararın etkisi, onay sırası; altta Reddet / Onayla. Ret sebebi
 * zorunludur ve personelin ekranında görünür.
 */
export function RequestDetail({ it, onClose }: { it: Item; onClose: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const m = useDecide(onClose);
  const d = describe(it);
  const requester = it.createdBy ?? it.employee.name;

  return (
    <div className="space-y-4 pb-40">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100" aria-label="Kapat">
          <X className="h-6 w-6" />
        </button>
        <h1 className="text-xl font-semibold">{d.screen}</h1>
      </div>

      <div className="flex items-start gap-3">
        <Avatar name={it.employee.name} />
        <div className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-slate-200">
          <div>
            <b>{it.employee.name}</b> {d.verb}
            {it.employee.manager && <ManagerTag />}
          </div>
          {it.note ? <div className="mt-1 text-slate-700">“{it.note}”</div> : <div className="mt-1 text-sm text-muted-foreground">Not yazılmamış.</div>}
        </div>
      </div>

      <div className="divide-y rounded-2xl border bg-white px-4">
        <Row label="Durum">
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-800">Onay bekliyor</span>
        </Row>
        <Row label="Kişi">
          {it.employee.position} · {it.employee.brand} {it.employee.store}
        </Row>
        {it.type === "leave" ? (
          <>
            <Row label="Tür">{LEAVE_LABEL[it.kind]}</Row>
            <Row label="Günler">{range(it.start, it.end)}</Row>
            <Row label="Düşülecek">{it.halfDay ? "Yarım gün" : `${num(it.days)} gün`}</Row>
          </>
        ) : it.type === "overtime" ? (
          <>
            <Row label="Gün">{dayLong(it.date)}</Row>
            <Row label="Süre">{hours(it.minutes)}</Row>
            <Row label="Sebep">{REASON_LABEL[it.reason] ?? it.reason}</Row>
          </>
        ) : (
          <>
            <Row label="Çalıştığı gün">{dayLong(it.date)}</Row>
            <Row label="Karşılığı">1 hak günü (8 saat)</Row>
          </>
        )}
      </div>

      {d.flag && <div className="rounded-xl bg-orange-50 p-3 text-sm font-medium text-orange-900">{d.flag}</div>}
      <Effects it={it} />

      <div>
        <div className="mb-2 text-sm font-semibold text-muted-foreground">Onay sırası</div>
        <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5">
          <li className="relative">
            <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-sky-500 ring-4 ring-slate-50" />
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{requester}</div>
                <div className="text-sm text-muted-foreground">
                  {it.createdBy ? "adına girdi" : it.employee.position} · {when(it.createdAt)}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800">Oluşturuldu</span>
            </div>
          </li>
          <li className="relative">
            <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-amber-500 ring-4 ring-slate-50" />
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{it.approver.names.join(", ") || "—"}</div>
                <div className="text-sm text-muted-foreground">{it.approver.role} onayı</div>
              </div>
              <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">Bekliyor</span>
            </div>
          </li>
        </ol>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-3xl space-y-2">
          {rejecting ? (
            <>
              <textarea
                className="w-full rounded-xl border border-slate-300 p-3 text-base outline-none focus:border-slate-900"
                rows={2}
                autoFocus
                placeholder="Neden reddediyorsunuz? (zorunlu — personel görecek)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex gap-2">
                <Button variant="outline" className="h-12 flex-1" onClick={() => setRejecting(false)}>
                  Vazgeç
                </Button>
                <Button
                  variant="destructive"
                  className="h-12 flex-1"
                  disabled={m.isPending || note.trim().length < 3}
                  onClick={() => m.mutate({ type: it.type, id: it.id, approve: false, note })}
                >
                  {m.isPending ? <Loader2 className="animate-spin" /> : <X />} Reddet
                </Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Button className="h-14 flex-1 rounded-xl bg-slate-800 text-base hover:bg-slate-900" disabled={m.isPending} onClick={() => setRejecting(true)}>
                <X /> Reddet
              </Button>
              <Button
                className="h-14 flex-1 rounded-xl bg-emerald-600 text-base hover:bg-emerald-700"
                disabled={m.isPending}
                onClick={() => m.mutate({ type: it.type, id: it.id, approve: true })}
              >
                {m.isPending ? <Loader2 className="animate-spin" /> : <Check />} Onayla
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
