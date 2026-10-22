"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import { toast } from "sonner";
import { AlarmClock, ArrowLeft, CalendarHeart, CheckCircle2, Clock, Loader2, Palmtree, Sun, Undo2, UserRound } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { FeedPreview } from "./feed";
import { trpc } from "@/lib/trpc";
import { restDayOvertimeAllowed } from "@/server/services/hr/rules";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { STATUS_TEXT, TONE_CLS, addDays, dayLong, dayMonth, daysLeftText, hours, isSunday, num, range } from "./format";

type Me = inferRouterOutputs<AppRouter>["hr"]["me"];
type Mine = NonNullable<Me["mine"]>;
type View = "home" | "worked" | "leave" | "overtime";

/**
 * PERSONEL ANA EKRANI (telefon önce). Personel eğitimli değil (sahibi): her
 * ekranda tek iş, büyük düğme, ne olacağını söyleyen kısa cümle, renk.
 */
const FORM_VIEWS: View[] = ["worked", "leave", "overtime"];

export function StaffHome() {
  const q = trpc.hr.me.useQuery();
  const params = useSearchParams();
  const router = useRouter();
  const [view, setView] = useState<View>("home");
  // Alt menüdeki ➕: /ik?form=leave → doğrudan o form
  const form = params.get("form") as View | null;
  useEffect(() => {
    if (form && FORM_VIEWS.includes(form)) setView(form);
  }, [form]);

  if (q.isLoading) {
    return (
      <div className="flex justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (q.error || !q.data) return <Notice tone="red" title="Sayfa açılamadı" text={q.error?.message ?? "Biraz sonra yeniden deneyin."} />;
  const me = q.data;
  if (!me.mine) {
    return (
      <Notice
        tone="amber"
        title="Hesabınız henüz hazır değil"
        text={
          me.isManager
            ? "Hesabınız bir personel kaydına bağlı değil; kendi izinlerinizi göremezsiniz. Mağazanızın onaylarını “Onaylar” sekmesinden yapabilirsiniz."
            : "Hesabınız bir personel kaydına bağlı değil. Lütfen yöneticinize söyleyin."
        }
      />
    );
  }
  const back = () => {
    setView("home");
    if (form) router.replace("/ik"); // ➕ ile yeniden açılabilsin
  };
  if (view === "worked") return <WorkedDayForm me={me} mine={me.mine} onDone={back} />;
  if (view === "leave") return <LeaveForm me={me} mine={me.mine} onDone={back} />;
  if (view === "overtime") return <OvertimeForm me={me} onDone={back} />;
  return <Home me={me} mine={me.mine} go={setView} />;
}

// ── Ana ekran ───────────────────────────────────────────────

function Home({ me, mine, go }: { me: Me; mine: Mine; go: (v: View) => void }) {
  const s = mine.summary;
  const openCredits = s.lieu.credits.filter((c) => c.state !== "used");
  const urgent = openCredits.filter((c) => c.state === "warn" || c.state === "overdue" || c.state === "remind");
  const first = mine.employee.full_name.split(" ")[0];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Merhaba {first} 👋</h1>
        <p className="text-sm text-muted-foreground">
          {mine.employee.store.brand.name} {mine.employee.store.name} · bugün {dayLong(me.today)}
        </p>
        <Link href="/ik/bilgilerim" className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-medium ring-1 ring-slate-200">
          <UserRound className="h-4 w-4" /> Bilgilerim ›
        </Link>
      </div>

      {urgent.map((c) => (
        <div key={c.id} className={cn("rounded-2xl border-2 p-4", TONE_CLS[c.tone])}>
          <div className="flex items-start gap-3">
            <AlarmClock className="mt-0.5 h-6 w-6 shrink-0" />
            <div>
              <div className="font-semibold">
                {c.state === "overdue" ? "Kullanılmamış izin günü!" : "İzin gününüzü kullanmayı unutmayın"}
              </div>
              <div className="text-sm">
                {dayMonth(c.date)} {c.kind === "holiday" ? "bayramında" : "pazarında"} çalıştınız. Karşılığındaki 1 gün izni{" "}
                {c.state === "overdue" ? <b>süresi geçti ({daysLeftText(c.daysLeft)}) — hemen müdürünüzle konuşun.</b> : <b>{dayLong(c.deadline)} gününe kadar kullanın ({daysLeftText(c.daysLeft)}).</b>}
              </div>
            </div>
          </div>
        </div>
      ))}

      <div className="grid gap-3 sm:grid-cols-3">
        <BalanceCard
          icon={<Palmtree className="h-5 w-5" />}
          title="Yıllık izin"
          big={s.annual.known ? `${s.annual.whole} gün` : "—"}
          lines={
            s.annual.known
              ? [
                  "Çalıştıkça her ay biraz daha birikir.",
                  s.annual.nextWholeDayDate ? `${dayLong(s.annual.nextWholeDayDate)} günü 1 gün daha eklenecek.` : "",
                  s.annual.used ? `Bu yıl kullanılan: ${num(s.annual.used)} gün.` : "",
                  s.annual.waiting ? `${num(s.annual.waiting)} gün onay bekliyor.` : "",
                ]
              : ["İşe giriş tarihiniz kayıtlı değil. Yöneticinize söyleyin."]
          }
          tone={s.annual.whole < 0 ? "red" : "neutral"}
        />
        <BalanceCard
          icon={<CalendarHeart className="h-5 w-5" />}
          title="Hak günü (pazar / bayram)"
          big={`${num(s.lieu.balance)} gün`}
          lines={[
            s.lieu.balance === 0 ? "Kullanılmamış hak gününüz yok. 👍" : "Pazar ya da bayram çalıştığınız günlerin karşılığı. Ay bitmeden kullanılmalı.",
            s.lieu.waitingClaims ? `${s.lieu.waitingClaims} bildirim müdür onayı bekliyor.` : "",
          ]}
          tone={openCredits.some((c) => c.tone === "red") ? "red" : openCredits.length ? "yellow" : "green"}
        >
          {openCredits.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {openCredits.map((c) => (
                <li key={c.id} className="flex justify-between gap-2">
                  <span>{dayLong(c.date)}</span>
                  <span className="font-medium">{daysLeftText(c.daysLeft)}</span>
                </li>
              ))}
            </ul>
          )}
        </BalanceCard>
        <BalanceCard
          icon={<Clock className="h-5 w-5" />}
          title="Bu ay mesai"
          big={hours(s.overtimeMonth.approvedMinutes)}
          lines={["Onaylanan hafta içi mesai. Maaşınıza eklenir.", s.overtimeMonth.waitingMinutes ? `${hours(s.overtimeMonth.waitingMinutes)} onay bekliyor.` : ""]}
          tone="neutral"
        />
      </div>

      <div className="grid gap-3">
        <BigAction icon={<Sun className="h-7 w-7" />} title="Pazar / bayram çalıştım" text="Karşılığında 1 gün izin kazanırsınız." onClick={() => go("worked")} cls="bg-amber-500 hover:bg-amber-600" />
        <BigAction icon={<Palmtree className="h-7 w-7" />} title="İzin istiyorum" text="Hak günü, yıllık izin, hastalık…" onClick={() => go("leave")} cls="bg-emerald-600 hover:bg-emerald-700" />
        <BigAction
          icon={<Clock className="h-7 w-7" />}
          title="Mesai yazdım"
          text={restDayOvertimeAllowed(mine.employee.store.brand.name) ? "Normal saatinizden fazla çalıştıysanız." : "Hafta içi fazla çalıştıysanız."}
          onClick={() => go("overtime")}
          cls="bg-indigo-600 hover:bg-indigo-700"
        />
      </div>

      <FeedPreview />

      <MyRequests rows={mine.requests} />
    </div>
  );
}

function BalanceCard({
  icon,
  title,
  big,
  lines,
  tone,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  big: string;
  lines: string[];
  tone: keyof typeof TONE_CLS;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-2xl border p-4", TONE_CLS[tone])}>
      <div className="flex items-center gap-2 text-sm font-medium opacity-80">
        {icon}
        {title}
      </div>
      <div className="mt-1 text-3xl font-bold tracking-tight">{big}</div>
      {lines.filter(Boolean).map((l) => (
        <p key={l} className="mt-1 text-sm opacity-80">
          {l}
        </p>
      ))}
      {children}
    </div>
  );
}

function BigAction({ icon, title, text, onClick, cls }: { icon: React.ReactNode; title: string; text: string; onClick: () => void; cls: string }) {
  return (
    <button onClick={onClick} className={cn("flex w-full items-center gap-4 rounded-2xl p-5 text-left text-white shadow-sm transition active:scale-[0.98]", cls)}>
      <span className="rounded-full bg-white/20 p-3">{icon}</span>
      <span>
        <span className="block text-lg font-semibold">{title}</span>
        <span className="block text-sm opacity-90">{text}</span>
      </span>
    </button>
  );
}

export function MyRequests({ rows }: { rows: Mine["requests"] }) {
  const utils = trpc.useUtils();
  const cancel = trpc.hr.cancel.useMutation({
    onSuccess: () => {
      toast.success("Talep geri çekildi");
      void utils.hr.me.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">Taleplerim</h2>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Henüz talebiniz yok.</p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-white">
          {rows.map((r) => (
            <li key={`${r.type}-${r.id}`} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{r.label}</div>
                <div className="text-sm text-muted-foreground">
                  {range(r.date, r.end)} · {r.detail}
                </div>
                {r.note && r.status === "rejected" && <div className="text-sm text-red-700">Sebep: {r.note}</div>}
              </div>
              <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", STATUS_TEXT[r.status].cls)}>{STATUS_TEXT[r.status].label}</span>
              {r.status === "waiting" && (
                <Button size="icon" variant="ghost" title="Geri çek" disabled={cancel.isPending} onClick={() => cancel.mutate({ type: r.type, id: r.id })}>
                  <Undo2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Formlar ─────────────────────────────────────────────────

function FormShell({ title, text, onBack, children }: { title: string; text: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Geri
      </button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      {children}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs text-white">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SubmitBar({ disabled, pending, label, error, onClick }: { disabled: boolean; pending: boolean; label: string; error: string | null; onClick: () => void }) {
  return (
    <div className="space-y-2 pt-2">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      <Button className="h-14 w-full rounded-2xl text-base" disabled={disabled || pending} onClick={onClick}>
        {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
        {label}
      </Button>
    </div>
  );
}

const Choice = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn("w-full rounded-xl border-2 p-3 text-left transition", active ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white")}
  >
    {children}
  </button>
);

const textareaCls = "w-full rounded-xl border border-slate-300 bg-white p-3 text-base outline-none focus:border-slate-900";
const dateCls = "h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-slate-900";

function useDone(onDone: () => void, message: string) {
  const utils = trpc.useUtils();
  return () => {
    toast.success(message);
    void utils.hr.me.invalidate();
    onDone();
  };
}

export function WorkedDayForm({ me, mine, onDone }: { me: Me; mine: Mine; onDone: () => void }) {
  const holidays = useMemo(() => new Set(me.holidays.map((h) => h.date)), [me.holidays]);
  const claimed = new Set(mine.requests.filter((r) => r.type === "worked" && (r.status === "waiting" || r.status === "approved")).map((r) => r.date));
  // Son 5 haftanın pazarları ve bayramları — tek dokunuşla seçilsin
  const options: string[] = [];
  for (let d = me.today; d >= addDays(me.today, -35); d = addDays(d, -1)) {
    if ((isSunday(d) || holidays.has(d)) && !claimed.has(d) && (!me.lockedBefore || d >= me.lockedBefore)) options.push(d);
  }
  const [date, setDate] = useState<string>(options[0] ?? "");
  const [note, setNote] = useState("");
  const done = useDone(onDone, "Bildiriminiz müdürünüze gitti. Onaylanınca 1 hak günü eklenecek.");
  const m = trpc.hr.claimWorkedDay.useMutation({ onSuccess: done });
  const holidayName = (d: string) => me.holidays.find((h) => h.date === d)?.name;

  return (
    <FormShell title="Pazar / bayram çalıştım" text="Pazar ya da bayram günü çalıştıysanız bildirin. Müdürünüz onaylayınca 1 gün izin hakkınız olur. Saat yazmanıza gerek yok." onBack={onDone}>
      <Step n={1} title="Hangi gün çalıştınız?">
        {options.length === 0 && <p className="text-sm text-muted-foreground">Son haftalarda bildirilecek pazar ya da bayram yok.</p>}
        <div className="grid gap-2">
          {options.map((d) => (
            <Choice key={d} active={date === d} onClick={() => setDate(d)}>
              <div className="font-medium">{dayLong(d)}</div>
              {holidayName(d) && <div className="text-sm text-muted-foreground">{holidayName(d)}</div>}
            </Choice>
          ))}
        </div>
      </Step>
      <Step n={2} title="Not (isterseniz)">
        <textarea className={textareaCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Örn. sayım için geldim" />
      </Step>
      <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
        {restDayOvertimeAllowed(mine.employee.store.brand.name) ? (
          <>
            Bu bildirim <b>8 saati</b> karşılar (1 hak günü). 8 saatten fazla çalıştıysanız fazlasını ayrıca “Mesai yazdım”dan yazın.
          </>
        ) : (
          <>
            Pazar ve bayram günleri <b>en çok 8 saat</b> çalışılır ve molalar kullanılır; bu günler için mesai yazılmaz.
          </>
        )}
      </div>
      <SubmitBar disabled={!date} pending={m.isPending} label="Bildir" error={m.error?.message ?? null} onClick={() => m.mutate({ date, note: note || undefined })} />
    </FormShell>
  );
}

export function LeaveForm({ me, mine, onDone }: { me: Me; mine: Mine; onDone: () => void }) {
  const s = mine.summary;
  const holidays = useMemo(() => new Set(me.holidays.map((h) => h.date)), [me.holidays]);
  const [kind, setKind] = useState<Me["leaveKinds"][number]["code"] | null>(s.lieu.available > 0 ? "lieu" : null);
  const [start, setStart] = useState(addDays(me.today, 1));
  const [end, setEnd] = useState(addDays(me.today, 1));
  const [half, setHalf] = useState(false);
  const [note, setNote] = useState("");
  const done = useDone(onDone, "İzin talebiniz müdürünüze gitti.");
  const m = trpc.hr.requestLeave.useMutation({ onSuccess: done });
  const k = me.leaveKinds.find((x) => x.code === kind);

  let count = 0;
  if (start && end && end >= start) for (let d = start; d <= end; d = addDays(d, 1)) if (!isSunday(d) && !holidays.has(d)) count += 1;
  const days = half && start === end ? 0.5 : count;
  const extra = (code: string) =>
    code === "lieu" ? `${num(s.lieu.available)} gün kullanılabilir` : code === "annual" && s.annual.known ? `${s.annual.wholeAvailable} gün kaldı` : code === "sick" ? `bu yıl ${num(s.sick.used)} / ${s.sick.allowance} gün` : "";

  return (
    <FormShell title="İzin istiyorum" text="Türü ve günleri seçin. Müdürünüz onaylayınca izniniz kesinleşir." onBack={onDone}>
      <Step n={1} title="Ne tür izin?">
        <div className="grid gap-2">
          {me.leaveKinds.map((x) => (
            <Choice key={x.code} active={kind === x.code} onClick={() => setKind(x.code)}>
              <div className="flex justify-between gap-2">
                <span className="font-medium">{x.label}</span>
                <span className="text-sm font-medium text-muted-foreground">{extra(x.code)}</span>
              </div>
              <div className="text-sm text-muted-foreground">{x.hint}</div>
            </Choice>
          ))}
        </div>
      </Step>
      <Step n={2} title="Hangi günler?">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">
            İlk gün
            <input
              type="date"
              className={dateCls}
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (!end || end < e.target.value) setEnd(e.target.value);
              }}
            />
          </label>
          <label className="text-sm">
            Son gün
            <input type="date" className={dateCls} value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        {k?.halfDay && start === end && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={half} onChange={(e) => setHalf(e.target.checked)} /> Yarım gün
          </label>
        )}
        {start && end && end >= start && (
          <div className="rounded-xl bg-slate-100 p-3 text-sm">
            {range(start, end)} → <b>{num(days)} gün</b> izninizden düşülecek.
            {count < 1 + Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) && " (Pazar ve resmi tatil sayılmaz.)"}
          </div>
        )}
      </Step>
      <Step n={3} title="Not (isterseniz)">
        <textarea className={textareaCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Step>
      <SubmitBar
        disabled={!kind || days <= 0}
        pending={m.isPending}
        label="İzin iste"
        error={m.error?.message ?? null}
        onClick={() => kind && m.mutate({ kind, start, end, halfDay: half && start === end, note: note || undefined })}
      />
    </FormShell>
  );
}

export function OvertimeForm({ me, onDone }: { me: Me; onDone: () => void }) {
  const holidays = useMemo(() => new Set(me.holidays.map((h) => h.date)), [me.holidays]);
  const [date, setDate] = useState(me.today);
  const [minutes, setMinutes] = useState(60);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const done = useDone(onDone, "Mesainiz müdürünüze gitti.");
  const m = trpc.hr.claimOvertime.useMutation({ onSuccess: done });
  const restDayOk = restDayOvertimeAllowed(me.mine?.employee.store.brand.name);
  const restDay = isSunday(date) || holidays.has(date);
  const blocked = restDay && !restDayOk;
  const r = me.overtimeReasons.find((x) => x.code === reason);

  return (
    <FormShell
      title="Mesai yazdım"
      text={`${restDayOk ? "Normal" : "Hafta içi normal"} saatinizden fazla çalıştıysanız yazın. Müdürünüz onaylayınca maaşınıza eklenir.`}
      onBack={onDone}
    >
      <Step n={1} title="Hangi gün?">
        <input type="date" className={dateCls} value={date} max={me.today} onChange={(e) => setDate(e.target.value)} />
        {blocked && (
          <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            Bu gün pazar ya da bayram. Pazar ve bayram en çok 8 saat çalışılır, molalar kullanılır; mesai yazılmaz. “Pazar / bayram çalıştım” bildirimi yapın.
          </div>
        )}
        {restDay && !blocked && (
          <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            Pazar / bayram: önce o günü “Pazar / bayram çalıştım” ile bildirin (8 saat = 1 hak günü). Buraya yalnız <b>8 saatin üstündeki</b> süreyi yazın; bu süre 2 kat ödenir.
          </div>
        )}
      </Step>
      <Step n={2} title="Kaç saat fazla çalıştınız?">
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-white p-2">
          <Button variant="outline" className="h-12 w-14 text-xl" onClick={() => setMinutes((x) => Math.max(30, x - 30))}>
            −
          </Button>
          <div className="text-2xl font-bold">{hours(minutes)}</div>
          <Button variant="outline" className="h-12 w-14 text-xl" onClick={() => setMinutes((x) => x + 30)}>
            +
          </Button>
        </div>
        {minutes > 240 && <p className="text-sm text-muted-foreground">Uzun mesai — müdürünüz ayrıca kontrol edecek.</p>}
      </Step>
      <Step n={3} title="Neden?">
        <div className="grid gap-2">
          {me.overtimeReasons.map((x) => (
            <Choice key={x.code} active={reason === x.code} onClick={() => setReason(x.code)}>
              <span className="font-medium">{x.label}</span>
            </Choice>
          ))}
        </div>
        {r?.needsNote && (
          <label className="block space-y-1">
            <span className="text-sm font-medium">
              Açıklama <span className="text-red-600">(zorunlu)</span>
            </span>
            <textarea
              className={textareaCls}
              rows={3}
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Listede olmayan sebebi yazın. Örn. vitrin değişimi için geç kaldım"
            />
            {note.trim().length < 5 && <span className="text-xs text-muted-foreground">Göndermek için ne yaptığınızı kısaca yazın.</span>}
          </label>
        )}
      </Step>
      <SubmitBar
        disabled={blocked || !reason || (!!r?.needsNote && note.trim().length < 5)}
        pending={m.isPending}
        label="Mesaiyi gönder"
        error={m.error?.message ?? null}
        onClick={() => reason && m.mutate({ date, minutes, reason, note: note || undefined })}
      />
    </FormShell>
  );
}

export function Notice({ tone, title, text }: { tone: "red" | "amber" | "green"; title: string; text: string }) {
  const cls = { red: TONE_CLS.red, amber: TONE_CLS.yellow, green: TONE_CLS.green }[tone];
  return (
    <div className={cn("rounded-2xl border-2 p-5", cls)}>
      <div className="text-lg font-semibold">{title}</div>
      <p className="mt-1 text-sm">{text}</p>
    </div>
  );
}
