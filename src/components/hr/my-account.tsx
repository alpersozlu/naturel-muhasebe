"use client";

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowLeft, CalendarDays, CalendarHeart, ChevronRight, KeyRound, ListChecks, Loader2, LogOut, Palmtree, Stethoscope, UserRound } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { ChangePasswordDialog } from "@/components/layout/change-password-dialog";
import { cn } from "@/lib/utils";
import { Avatar } from "./avatar";
import { STATUS_TEXT, TONE_CLS, dateNum, dayLong, dayMonth, daysLeftText, num, range } from "./format";
import { MyRequests, Notice } from "./staff-home";

type Me = inferRouterOutputs<AppRouter>["hr"]["me"];
type Mine = NonNullable<Me["mine"]>;

const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

function useMine(): { me: Me; mine: Mine } | { node: React.ReactNode } {
  const q = trpc.hr.me.useQuery();
  if (q.isLoading) return { node: <Loader2 className="mx-auto mt-20 h-6 w-6 animate-spin text-muted-foreground" /> };
  if (q.error || !q.data) return { node: <Notice tone="red" title="Açılamadı" text={q.error?.message ?? ""} /> };
  if (!q.data.mine) return { node: <Notice tone="amber" title="Hesabınız henüz hazır değil" text="Hesabınız bir personel kaydına bağlı değil. Lütfen yöneticinize söyleyin." /> };
  return { me: q.data, mine: q.data.mine };
}

function tenureText(start: Date | string | null, today: string): string | null {
  if (!start) return null;
  const s = new Date(start).toISOString().slice(0, 10);
  const [y1, m1, d1] = s.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = today.split("-").map(Number) as [number, number, number];
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (months < 1) return "yeni başladı";
  const years = Math.floor(months / 12);
  months %= 12;
  return [years ? `${years} yıl` : "", months ? `${months} ay` : ""].filter(Boolean).join(" ");
}

const Back = () => (
  <Link href="/ik/hesabim" className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
    <ArrowLeft className="h-4 w-4" /> Hesabım
  </Link>
);

// ── Hesabım ────────────────────────────────────────────────

/** HESABIM — Kolay İK'daki "Hesabım"ın açık hali: kim, ne kadar izni var, her şeye tek dokunuş. */
export function MyAccount() {
  const r = useMine();
  const email = trpc.user.me.useQuery().data?.email ?? "";
  const [pw, setPw] = useState(false);
  if ("node" in r) return <>{r.node}</>;
  const { me, mine } = r;
  const s = mine.summary;
  const e = mine.employee;
  const waiting = mine.requests.filter((x) => x.status === "waiting").length;
  const tenure = tenureText(e.start_date, me.today);
  const signOut = async () => {
    await createClient().auth.signOut({ scope: "local" });
    window.location.assign("/tr/login");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center rounded-3xl border bg-white p-6 text-center">
        <div className="scale-150 py-3">
          <Avatar name={e.full_name} />
        </div>
        <div className="mt-2 text-xl font-semibold">{e.full_name}</div>
        <div className="text-sm text-muted-foreground">
          {e.position} · {e.store.brand.name} {e.store.name}
        </div>
        {tenure && <div className="mt-1 text-sm text-muted-foreground">Naturel Ticaret&apos;te {tenure}</div>}
      </div>

      <Link href="/ik/izinlerim" className="block rounded-2xl border bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="font-semibold">İzinlerim</div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <MiniStat label="Yıllık izin" value={s.annual.known ? `${s.annual.whole}` : "—"} unit="gün" cls="bg-emerald-50 text-emerald-900" />
          <MiniStat label="Hak günü" value={num(s.lieu.balance)} unit="gün" cls={s.lieu.balance > 0 ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-800"} />
          <MiniStat label="Hastalık" value={`${num(s.sick.allowance - s.sick.used)}`} unit="gün kaldı" cls="bg-sky-50 text-sky-900" />
        </div>
      </Link>

      <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
        <MenuRow href="/ik/izinlerim" icon={<Palmtree className="h-5 w-5" />} label="İzinlerim" hint={`${s.annual.known ? s.annual.whole : "—"} gün yıllık`} />
        <MenuRow href="/ik/talepler" icon={<ListChecks className="h-5 w-5" />} label="Taleplerim" hint={waiting ? `${waiting} onay bekliyor` : undefined} />
        <MenuRow href="/ik/bilgilerim" icon={<UserRound className="h-5 w-5" />} label="Bilgilerim" hint="telefon, adres, acil durum" />
        <MenuRow href="/ik/ajanda" icon={<CalendarDays className="h-5 w-5" />} label="Ajanda" hint="izinler, doğum günleri" />
        <li>
          <button type="button" onClick={() => setPw(true)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
            <span className="text-indigo-600">
              <KeyRound className="h-5 w-5" />
            </span>
            <span className="flex-1 font-medium">Şifremi değiştir</span>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>
        </li>
        <li>
          <button type="button" onClick={signOut} className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-red-700">
            <LogOut className="h-5 w-5" />
            <span className="flex-1 font-medium">Çıkış yap</span>
          </button>
        </li>
      </ul>
      {email && <ChangePasswordDialog open={pw} onClose={() => setPw(false)} email={email} />}
    </div>
  );
}

function MiniStat({ label, value, unit, cls }: { label: string; value: string; unit: string; cls: string }) {
  return (
    <div className={cn("rounded-xl p-2.5", cls)}>
      <div className="text-xs opacity-80">{label}</div>
      <div className="text-2xl font-bold leading-tight">{value}</div>
      <div className="text-xs opacity-80">{unit}</div>
    </div>
  );
}

function MenuRow({ href, icon, label, hint }: { href: string; icon: React.ReactNode; label: string; hint?: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-4 py-3.5">
        <span className="text-indigo-600">{icon}</span>
        <span className="flex-1 font-medium">{label}</span>
        {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </Link>
    </li>
  );
}

// ── İzinlerim ──────────────────────────────────────────────

/**
 * İZİNLERİM — Kolay İK'daki tek çubuk ("3 gün", yeşil/kırmızı) yerine:
 * kaç gün var, nasıl birikti (ay ay), ne kadar kullanıldı, yıl sonunda ne
 * olacak; hak günleri tek tek son günüyle; hastalık; bu yılki izin geçmişi.
 */
export function MyLeaves() {
  const r = useMine();
  if ("node" in r) return <>{r.node}</>;
  const { me, mine } = r;
  const s = mine.summary;
  const a = s.annual;
  const totalWhole = Math.floor(a.opening + a.earned + 1e-9);
  const usedPct = totalWhole > 0 ? Math.min(100, (a.used / totalWhole) * 100) : 0;
  const nowMonth = Number(me.today.slice(5, 7));
  const credits = [...s.lieu.credits].sort((x, y) => y.date.localeCompare(x.date));
  const year = me.today.slice(0, 4);
  const history = mine.requests.filter((x) => x.type === "leave" && x.date.startsWith(year) && x.status === "approved");

  return (
    <div className="space-y-4">
      <Back />
      <h1 className="text-2xl font-semibold tracking-tight">İzinlerim</h1>

      <section className="rounded-3xl border bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
          <Palmtree className="h-4 w-4" /> Yıllık izin
        </div>
        {a.known ? (
          <>
            <div className="mt-1 text-5xl font-bold tracking-tight">
              {a.whole} <span className="text-2xl font-semibold text-muted-foreground">gün</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">kullanabileceğiniz yıllık izin</p>

            <div className="mt-4">
              <div className="flex h-4 overflow-hidden rounded-full bg-emerald-500">
                <div className="h-full bg-slate-300" style={{ width: `${usedPct}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between text-xs">
                <span className="text-slate-600">⬤ Kullanılan {num(a.used)} gün</span>
                <span className="text-emerald-700">⬤ Kalan {a.whole} gün</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Bu yıl toplam hakkınız {totalWhole} gün{a.opening ? ` (geçen yıldan ${Math.floor(a.opening + 1e-9)} gün devreden dahil)` : ""}.
              </p>
            </div>

            <div className="mt-5">
              <div className="mb-1.5 text-sm font-semibold">Ay ay nasıl birikiyor?</div>
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
                {MONTHS.map((m, idx) => {
                  const n = idx + 1;
                  const earned = n >= a.firstMonth && n < a.firstMonth + a.months;
                  const current = !earned && n === nowMonth;
                  const before = n < a.firstMonth;
                  return (
                    <div
                      key={m}
                      className={cn(
                        "rounded-lg py-1.5 text-center text-xs font-medium",
                        earned ? "bg-emerald-500 text-white" : current ? "bg-emerald-100 text-emerald-800 ring-2 ring-emerald-400" : before ? "bg-slate-50 text-slate-300" : "bg-slate-100 text-slate-500"
                      )}
                    >
                      {m}
                      <div className="text-[10px] font-normal">{earned ? "✓" : current ? "bu ay" : before ? "—" : ""}</div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">Yılda 14 gün: her ayı tamamladığınızda izniniz biraz artar. 6 ay çalışan 1 hafta kazanır.</p>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {a.nextWholeDayDate && (
                <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
                  📅 <b>{dayLong(a.nextWholeDayDate)}</b> günü 1 gün daha eklenecek.
                </div>
              )}
              {a.yearEndWhole !== null && (
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  🎯 Başka izin kullanmazsanız yıl sonunda <b>{a.yearEndWhole} gün</b> izniniz olur.
                </div>
              )}
              {a.waiting > 0 && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">⏳ {num(a.waiting)} gün onay bekliyor.</div>}
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-red-700">İşe giriş tarihiniz kayıtlı değil — yöneticinize söyleyin.</p>
        )}
      </section>

      <section className="rounded-3xl border bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
          <CalendarHeart className="h-4 w-4" /> Hak günlerim (pazar / bayram)
        </div>
        <div className="mt-1 text-3xl font-bold">
          {num(s.lieu.balance)} <span className="text-lg font-semibold text-muted-foreground">gün kullanılmadı</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Çalıştığınız her pazar ya da bayram 1 gün. Ay bitmeden kullanmalısınız; yıllık izninizden düşmez.</p>
        {credits.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">Bu dönem pazar / bayram çalışmanız yok.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {credits.map((c) => (
              <li key={c.id} className={cn("flex items-center justify-between gap-2 rounded-xl border p-3 text-sm", TONE_CLS[c.tone])}>
                <div>
                  <div className="font-medium">
                    {dayLong(c.date)} {c.kind === "holiday" ? "(bayram)" : ""}
                  </div>
                  <div className="opacity-80">
                    {c.state === "used" ? `Karşılığı kullanıldı: ${c.usedOn ? dayMonth(c.usedOn) : ""}` : `Son gün ${dayLong(c.deadline)}`}
                  </div>
                </div>
                <span className="shrink-0 font-semibold">{c.state === "used" ? "✓ kullanıldı" : daysLeftText(c.daysLeft)}</span>
              </li>
            ))}
          </ul>
        )}
        {s.lieu.waitingClaims > 0 && <p className="mt-2 text-sm text-amber-800">⏳ {s.lieu.waitingClaims} pazar / bayram bildiriminiz müdür onayı bekliyor.</p>}
        {s.lieu.balance > 0 && (
          <Link href="/ik?form=leave" className="mt-3 block rounded-xl bg-amber-500 p-3 text-center font-semibold text-white">
            Hak günümü kullanmak istiyorum
          </Link>
        )}
      </section>

      <section className="rounded-3xl border bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-sky-700">
          <Stethoscope className="h-4 w-4" /> Hastalık izni
        </div>
        <div className="mt-1 text-3xl font-bold">
          {num(s.sick.allowance - s.sick.used)} <span className="text-lg font-semibold text-muted-foreground">/ {s.sick.allowance} gün kaldı</span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-sky-100">
          <div className="h-full bg-sky-500" style={{ width: `${Math.min(100, (s.sick.used / s.sick.allowance) * 100)}%` }} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Bu yıl kullanılan {num(s.sick.used)} gün. Hastalık izni yıllık izninizden düşmez.</p>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">{year} yılında kullandığım izinler</h2>
        {history.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Bu yıl kullanılmış izin yok.</p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-white">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{h.label}</div>
                  <div className="text-sm text-muted-foreground">{range(h.date, h.end)}</div>
                </div>
                <span className="shrink-0 text-sm font-semibold">{h.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {mine.employee.start_date && <p className="text-center text-xs text-muted-foreground">İşe giriş: {dateNum(new Date(mine.employee.start_date).toISOString().slice(0, 10))}</p>}
    </div>
  );
}

// ── Taleplerim ─────────────────────────────────────────────

type Filter = "all" | "waiting" | "leave" | "worked" | "overtime";

/** TALEPLERİM — hepsi bir yerde, türe ve duruma göre süzülür; bekleyen geri çekilebilir. */
export function MyRequestsPage() {
  const r = useMine();
  const [f, setF] = useState<Filter>("all");
  if ("node" in r) return <>{r.node}</>;
  const rows = r.mine.requests.filter((x) => f === "all" || (f === "waiting" ? x.status === "waiting" : x.type === f));
  const chips: Array<[Filter, string]> = [
    ["all", "Tümü"],
    ["waiting", "Bekleyen"],
    ["leave", "İzin"],
    ["worked", "Pazar / bayram"],
    ["overtime", "Mesai"],
  ];
  const counts = (k: Filter) => r.mine.requests.filter((x) => k === "all" || (k === "waiting" ? x.status === "waiting" : x.type === k)).length;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Taleplerim</h1>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {chips.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setF(k)}
            className={cn("shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium", f === k ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200")}
          >
            {label} <span className="opacity-60">{counts(k)}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {(["waiting", "approved", "rejected"] as const).map((st) => (
          <span key={st} className={cn("rounded-full px-2 py-0.5", STATUS_TEXT[st].cls)}>
            {STATUS_TEXT[st].label}: {r.mine.requests.filter((x) => x.status === st).length}
          </span>
        ))}
      </div>
      <MyRequests rows={rows} />
    </div>
  );
}
