"use client";

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarHeart,
  Check,
  Clock,
  Copy,
  Lock,
  Loader2,
  Mail,
  MessageCircle,
  Palmtree,
  Pencil,
  Phone,
  Send,
  Stethoscope,
  UserX,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Avatar } from "./avatar";
import { STATUS_TEXT, TONE_CLS, dateNum, dayLong, daysLeftText, hours, num, range } from "./format";
import { Notice } from "./staff-home";

type Profile = inferRouterOutputs<AppRouter>["hr"]["profile"];
type Section = Profile["sections"][number];

const ACCOUNT_STATE = {
  none: { label: "Hesabı yok", cls: "bg-slate-100 text-slate-700" },
  invited: { label: "Davet edildi · henüz girmedi", cls: "bg-amber-100 text-amber-800" },
  active: { label: "Kullanıyor", cls: "bg-emerald-100 text-emerald-800" },
  suspended: { label: "Durduruldu", cls: "bg-red-100 text-red-700" },
} as const;

const tl = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (d: Date | string | null) =>
  d ? new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Nicosia", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d)) : "—";
const digits = (p: string) => p.replace(/[^\d]/g, "");

/**
 * PERSONEL KARTI (Kolay İK'daki kişi sayfasının gelişmişi): üstte kim, kaç
 * yıldır, tek dokunuşla ara / WhatsApp / e-posta, uyarılar (çalışma izni,
 * doğum günü), eksik bilgi; sekmeler Özet · Bilgiler · Hesap (davet,
 * hatırlatma, durdurma, işten çıkış ön hesabıyla).
 */
export function PersonCard({ id, onClose }: { id: string; onClose: () => void }) {
  const p = trpc.hr.profile.useQuery({ id });
  const [tab, setTab] = useState<"summary" | "info" | "account">("summary");
  if (p.isLoading) return <Loader2 className="mx-auto mt-20 h-6 w-6 animate-spin text-muted-foreground" />;
  if (p.error || !p.data) return <Notice tone="red" title="Açılamadı" text={p.error?.message ?? ""} />;
  const d = p.data;
  const e = d.employee;
  const field = (k: string) => d.sections.flatMap((s) => s.fields).find((f) => f.key === k)?.value ?? null;
  const phone = field("personal_phone") ?? field("work_phone");
  const email = field("personal_email") ?? field("work_email") ?? d.account?.email ?? null;
  const tabs = [
    { k: "summary" as const, label: "Özet" },
    { k: "info" as const, label: "Bilgiler" },
    ...(d.viewer === "admin" ? [{ k: "account" as const, label: "Hesap" }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100" aria-label="Kapat">
          <X className="h-6 w-6" />
        </button>
        <h1 className="text-xl font-semibold">Personel kartı</h1>
      </div>

      <div className="rounded-2xl border bg-white p-4">
        <div className="flex items-center gap-3">
          <Avatar name={e.name} />
          <div className="min-w-0">
            <div className="text-lg font-semibold">
              {e.name}
              {e.manager && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-normal">Müdür</span>}
            </div>
            <div className="text-sm text-muted-foreground">
              {e.position} · {e.brand} {e.store}
            </div>
            <div className="text-sm text-muted-foreground">
              {e.hireDate ? (
                <>
                  İşe giriş {dateNum(e.hireDate)}
                  {d.tenure && <b className="text-slate-700"> · {d.tenure}</b>}
                </>
              ) : (
                <span className="text-red-700">İşe giriş tarihi kayıtlı değil</span>
              )}
            </div>
          </div>
        </div>
        {d.account && <div className={cn("mt-3 inline-block rounded-full px-2.5 py-1 text-xs font-medium", ACCOUNT_STATE[d.account.state].cls)}>{ACCOUNT_STATE[d.account.state].label}</div>}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <QuickAction href={phone ? `tel:${digits(phone)}` : null} icon={<Phone className="h-5 w-5" />} label="Ara" />
          <QuickAction href={phone ? `https://wa.me/${digits(phone)}` : null} icon={<MessageCircle className="h-5 w-5" />} label="WhatsApp" />
          <QuickAction href={email ? `mailto:${email}` : null} icon={<Mail className="h-5 w-5" />} label="E-posta" />
        </div>
      </div>

      {d.alerts.length > 0 && (
        <ul className="space-y-1.5">
          {d.alerts.map((a) => (
            <li
              key={a.text}
              className={cn(
                "flex items-center gap-2 rounded-xl p-3 text-sm font-medium",
                a.tone === "red" ? "bg-red-50 text-red-800" : a.tone === "yellow" ? "bg-amber-50 text-amber-900" : "bg-sky-50 text-sky-900"
              )}
            >
              {a.tone !== "info" && <AlertTriangle className="h-4 w-4 shrink-0" />}
              {a.text}
            </li>
          ))}
        </ul>
      )}

      {d.completeness && d.completeness.percent < 100 && (
        <div className="rounded-2xl border bg-white p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">Bilgiler %{d.completeness.percent} dolu</span>
            <button type="button" className="text-sm font-medium text-indigo-700" onClick={() => setTab("info")}>
              Tamamla ›
            </button>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${d.completeness.percent}%` }} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Eksik: {d.completeness.missing.join(", ")}</p>
        </div>
      )}

      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setTab(t.k)}
            className={cn("flex-1 rounded-lg py-2 text-sm font-medium", tab === t.k ? "bg-white shadow-sm" : "text-slate-600")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "summary" && <SummaryTab id={id} />}
      {tab === "info" && <ProfileSections data={d} id={id} />}
      {tab === "account" && d.account && <AccountTab data={d} id={id} />}
    </div>
  );
}

function QuickAction({ href, icon, label }: { href: string | null; icon: React.ReactNode; label: string }) {
  const cls = "flex flex-col items-center gap-1 rounded-xl py-2.5 text-sm font-medium";
  if (!href)
    return (
      <span className={cn(cls, "bg-slate-50 text-slate-400")} title="Bilgi girilmemiş">
        {icon}
        {label}
      </span>
    );
  return (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className={cn(cls, "bg-indigo-50 text-indigo-700")}>
      {icon}
      {label}
    </a>
  );
}

// ── Özet ───────────────────────────────────────────────────

function SummaryTab({ id }: { id: string }) {
  const q = trpc.hr.person.useQuery({ id });
  if (q.isLoading) return <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-muted-foreground" />;
  if (!q.data) return null;
  const { summary: s, requests } = q.data;
  const open = s.lieu.credits.filter((c) => c.state !== "used");
  const pending = requests.filter((r) => r.status === "waiting").length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Tile icon={<Palmtree className="h-4 w-4" />} label="Yıllık izin" value={s.annual.known ? `${s.annual.whole} gün` : "—"} tone={s.annual.whole < 0 ? "red" : "neutral"} />
        <Tile icon={<CalendarHeart className="h-4 w-4" />} label="Hak günü açık" value={`${num(s.lieu.balance)} gün`} tone={open.some((c) => c.tone === "red") ? "red" : open.length ? "yellow" : "green"} />
        <Tile icon={<Clock className="h-4 w-4" />} label="Bu ay mesai" value={hours(s.overtimeMonth.approvedMinutes)} tone="neutral" />
        <Tile icon={<Stethoscope className="h-4 w-4" />} label="Hastalık (bu yıl)" value={`${num(s.sick.used)} / ${s.sick.allowance} gün`} tone="neutral" />
      </div>
      {open.length > 0 && (
        <div className="rounded-2xl border bg-white p-4">
          <div className="mb-1 text-sm font-semibold">Kullanılmamış hak günleri</div>
          <ul className="space-y-1 text-sm">
            {open.map((c) => (
              <li key={c.id} className={cn("flex justify-between gap-2", c.tone === "red" && "font-medium text-red-700")}>
                <span>{dayLong(c.date)}</span>
                <span>{daysLeftText(c.daysLeft)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {pending > 0 && (
        <Link href="/ik/onay" className="block rounded-2xl bg-amber-50 p-3 text-sm font-medium text-amber-900">
          {pending} talep onay bekliyor — Onaylar&apos;a git ›
        </Link>
      )}
      <div>
        <h2 className="mb-2 font-semibold">Son talepler</h2>
        {requests.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Talep yok.</p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-white">
            {requests.map((r) => (
              <li key={`${r.type}-${r.id}`} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.label}</div>
                  <div className="text-sm text-muted-foreground">
                    {range(r.date, r.end)} · {r.detail}
                  </div>
                  {r.note && r.status === "rejected" && <div className="text-sm text-red-700">Sebep: {r.note}</div>}
                </div>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", STATUS_TEXT[r.status].cls)}>{STATUS_TEXT[r.status].label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Tile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: keyof typeof TONE_CLS }) {
  return (
    <div className={cn("rounded-2xl border p-3", TONE_CLS[tone])}>
      <div className="flex items-center gap-1.5 text-xs font-medium opacity-80">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-xl font-bold">{value}</div>
    </div>
  );
}

// ── Bilgiler ───────────────────────────────────────────────

/** Bölüm bölüm bilgiler; düzeltilebilen bölümde "Düzenle". Personelin "Bilgilerim" ekranı da bunu kullanır. */
export function ProfileSections({ data, id }: { data: Profile; id?: string }) {
  return (
    <div className="space-y-3">
      {data.sections.map((s) => (
        <SectionCard key={s.key} section={s} id={id} />
      ))}
      {data.bank && (
        <div className="rounded-2xl border bg-white p-4">
          <SectionTitle title="Banka" adminOnly />
          <InfoRow label="IBAN" value={data.bank.iban} />
          <InfoRow label="Hesap no" value={data.bank.accountNo ? `${data.bank.branch ?? ""} ${data.bank.accountNo}`.trim() : null} />
          <InfoRow label="Hesap sahibi" value={data.bank.holder} />
          <p className="mt-2 text-xs text-muted-foreground">Banka bilgisi Maaşlar › Personel ekranından değişir.</p>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ title, adminOnly, action }: { title: string; adminOnly?: boolean; action?: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-center gap-2">
      <h3 className="font-semibold">{title}</h3>
      {adminOnly && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" /> yalnız yönetici görür
        </span>
      )}
      <span className="ml-auto">{action}</span>
    </div>
  );
}

function SectionCard({ section, id }: { section: Section; id?: string }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const save = trpc.hr.saveProfile.useMutation({
    onSuccess: () => {
      toast.success("Kaydedildi");
      setEditing(false);
      void utils.hr.profile.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const editable = section.fields.filter((f) => f.editable);
  const adminOnly = section.fields.every((f) => f.adminOnly);
  const start = () => {
    setVals(Object.fromEntries(editable.map((f) => [f.key, f.value ?? ""])));
    setEditing(true);
  };

  return (
    <div className="rounded-2xl border bg-white p-4">
      <SectionTitle
        title={section.title}
        adminOnly={adminOnly}
        action={
          editable.length > 0 && !editing ? (
            <button type="button" onClick={start} className="flex items-center gap-1 text-sm font-medium text-indigo-700">
              <Pencil className="h-3.5 w-3.5" /> Düzenle
            </button>
          ) : null
        }
      />
      {editing ? (
        <div className="space-y-3 pt-1">
          {editable.map((f) => (
            <label key={f.key} className="block text-sm">
              <span className="text-muted-foreground">{f.label}</span>
              <input
                type={f.type === "date" ? "date" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"}
                inputMode={f.type === "phone" ? "tel" : undefined}
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-slate-900"
                value={vals[f.key] ?? ""}
                onChange={(ev) => setVals((v) => ({ ...v, [f.key]: ev.target.value }))}
              />
            </label>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>
              Vazgeç
            </Button>
            <Button className="flex-1" disabled={save.isPending} onClick={() => save.mutate({ id, values: vals })}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Check />} Kaydet
            </Button>
          </div>
        </div>
      ) : (
        section.fields.map((f) => <InfoRow key={f.key} label={f.label} value={f.value} date={f.type === "date"} lock={f.adminOnly && !adminOnly} />)
      )}
    </div>
  );
}

function InfoRow({ label, value, date, lock }: { label: string; value: string | null; date?: boolean; lock?: boolean }) {
  const shown = value ? (date ? dateNum(value) : value) : null;
  return (
    <div className="flex items-center gap-2 border-t border-slate-100 py-2 first-of-type:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {label}
          {lock && <Lock className="h-3 w-3" />}
        </div>
        <div className={cn("break-words", !shown && "text-sm text-slate-400")}>{shown ?? "girilmemiş"}</div>
      </div>
      {shown && (
        <button
          type="button"
          aria-label="Kopyala"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          onClick={() => {
            void navigator.clipboard?.writeText(shown);
            toast.success("Kopyalandı");
          }}
        >
          <Copy className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ── Hesap (yalnız sahibi) ──────────────────────────────────

type LinkResult = { mailed: boolean; mailNote: string | null; whatsapp: string; link: string };

function AccountTab({ data, id }: { data: Profile; id: string }) {
  const a = data.account!;
  const utils = trpc.useUtils();
  const [email, setEmail] = useState(data.suggestedEmail ?? "");
  const [role, setRole] = useState<"staff" | "store_manager">(data.employee.manager || /müdür$/i.test(data.employee.position) ? "store_manager" : "staff");
  const [result, setResult] = useState<LinkResult | null>(null);
  const refresh = () => {
    void utils.hr.profile.invalidate();
    void utils.hr.people.invalidate();
  };
  const invite = trpc.hr.invite.useMutation({ onSuccess: (r) => (setResult(r), refresh()), onError: (e) => toast.error(e.message) });
  const remind = trpc.hr.remind.useMutation({ onSuccess: (r) => (setResult(r), refresh()), onError: (e) => toast.error(e.message) });
  const active = trpc.hr.setAccountActive.useMutation({
    onSuccess: (r) => (toast.success(r.active ? "Hesap yeniden açıldı" : "Hesap durduruldu"), refresh()),
    onError: (e) => toast.error(e.message),
  });
  const phone = data.sections.flatMap((s) => s.fields).find((f) => f.key === "personal_phone")?.value ?? null;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border bg-white p-4">
        <SectionTitle title="Giriş hesabı" />
        <ol className="relative mt-2 space-y-3 border-l-2 border-slate-200 pl-5 text-sm">
          <Step done={!!a.invitedAt} title="Davet gönderildi" sub={a.invitedAt ? `${when(a.invitedAt)}${a.inviteCount > 1 ? ` · ${a.inviteCount}. davet` : ""}` : "henüz değil"} />
          {a.lastReminderAt && <Step done title="Hatırlatma" sub={when(a.lastReminderAt)} />}
          <Step done={!!a.firstLogin} title="İlk giriş" sub={a.firstLogin ? when(a.firstLogin) : "henüz girmedi"} />
          <Step done={!!a.lastLogin} title="Son giriş" sub={a.lastLogin ? when(a.lastLogin) : "—"} />
        </ol>
        {a.email && <div className="mt-3 text-sm text-muted-foreground">Giriş e-postası: <b className="text-slate-800">{a.email}</b></div>}
      </div>

      {a.state === "none" ? (
        <div className="space-y-3 rounded-2xl border bg-white p-4">
          <SectionTitle title="Davet gönder" />
          <p className="text-sm text-muted-foreground">Kişiye “şifreni belirle” bağlantısı gider; kendi şifresini kendisi koyar. Geçici şifre yok.</p>
          <input
            type="email"
            className="h-11 w-full rounded-xl border border-slate-300 px-3 text-base"
            placeholder="E-posta adresi"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
          />
          <div className="flex gap-2">
            {(["staff", "store_manager"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={cn("flex-1 rounded-xl border-2 p-2.5 text-sm font-medium", role === r ? "border-slate-900 bg-slate-50" : "border-slate-200")}
              >
                {r === "staff" ? "Personel" : "Mağaza müdürü"}
                <span className="block text-xs font-normal text-muted-foreground">{r === "staff" ? "kendi izni ve mesaisi" : "+ mağazasının onayları"}</span>
              </button>
            ))}
          </div>
          <Button className="h-12 w-full" disabled={invite.isPending || !email.includes("@")} onClick={() => invite.mutate({ employeeId: id, email, role })}>
            {invite.isPending ? <Loader2 className="animate-spin" /> : <Send />} Davet gönder
          </Button>
        </div>
      ) : (
        <div className="grid gap-2">
          {a.state !== "suspended" && (
            <Button variant="outline" className="h-12" disabled={remind.isPending} onClick={() => remind.mutate({ employeeId: id })}>
              {remind.isPending ? <Loader2 className="animate-spin" /> : <Send />} {a.state === "invited" ? "Hatırlatma gönder" : "Şifre belirleme bağlantısı gönder"}
            </Button>
          )}
          <Button
            variant="outline"
            className={cn("h-12", a.state !== "suspended" && "text-red-700")}
            disabled={active.isPending}
            onClick={() => active.mutate({ employeeId: id, active: a.state === "suspended" })}
          >
            {a.state === "suspended" ? "Hesabı yeniden aç" : "Hesabı durdur (giriş kapanır, veriler kalır)"}
          </Button>
        </div>
      )}

      {result && <LinkResultBox r={result} phone={phone} onClose={() => setResult(null)} />}

      <TerminateBox id={id} name={data.employee.name} />
    </div>
  );
}

function Step({ done, title, sub }: { done: boolean; title: string; sub: string }) {
  return (
    <li className="relative">
      <span className={cn("absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-white", done ? "bg-emerald-500" : "bg-slate-300")} />
      <div className="font-medium">{title}</div>
      <div className="text-muted-foreground">{sub}</div>
    </li>
  );
}

function LinkResultBox({ r, phone, onClose }: { r: LinkResult; phone: string | null; onClose: () => void }) {
  return (
    <div className="space-y-2 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-emerald-900">{r.mailed ? "E-posta gönderildi ✓" : "Bağlantı hazır"}</div>
        <button type="button" onClick={onClose} aria-label="Kapat">
          <X className="h-4 w-4" />
        </button>
      </div>
      {r.mailNote && <p className="text-amber-900">{r.mailNote}</p>}
      <pre className="whitespace-pre-wrap break-words rounded-xl bg-white p-3 font-sans text-xs text-slate-700">{r.whatsapp}</pre>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => {
            void navigator.clipboard?.writeText(r.whatsapp);
            toast.success("Mesaj kopyalandı");
          }}
        >
          <Copy /> Mesajı kopyala
        </Button>
        {phone && (
          <Button asChild className="flex-1 bg-emerald-600 hover:bg-emerald-700">
            <a href={`https://wa.me/${digits(phone)}?text=${encodeURIComponent(r.whatsapp)}`} target="_blank" rel="noreferrer">
              <MessageCircle /> WhatsApp&apos;ta aç
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

function TerminateBox({ id, name }: { id: string; name: string }) {
  const utils = trpc.useUtils();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Nicosia" }).format(new Date());
  const [open, setOpen] = useState(false);
  const [endDate, setEndDate] = useState(today);
  const [note, setNote] = useState("");
  const [sure, setSure] = useState(false);
  const preview = trpc.hr.exitPreview.useQuery({ employeeId: id, endDate }, { enabled: open && /^\d{4}-\d{2}-\d{2}$/.test(endDate) });
  const term = trpc.hr.terminate.useMutation({
    onSuccess: () => {
      toast.success(`${name} işten çıkarıldı`);
      void utils.hr.people.invalidate();
      void utils.hr.profile.invalidate();
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white p-3 text-sm font-medium text-red-700">
        <UserX className="h-4 w-4" /> İşten çıkar
      </button>
    );
  const p = preview.data;
  return (
    <div className="space-y-3 rounded-2xl border-2 border-red-200 bg-white p-4">
      <SectionTitle title="İşten çıkar" />
      <label className="block text-sm">
        <span className="text-muted-foreground">Son çalıştığı gün</span>
        <input type="date" className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-base" value={endDate} onChange={(ev) => (setEndDate(ev.target.value), setSure(false))} />
      </label>
      <input className="h-11 w-full rounded-xl border border-slate-300 px-3 text-base" placeholder="Not (isteğe bağlı) — örn. kendi isteğiyle" value={note} onChange={(ev) => setNote(ev.target.value)} />
      <div className="rounded-xl bg-slate-50 p-3 text-sm">
        <div className="mb-1 font-semibold">Çıkış ön hesabı</div>
        {preview.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : p ? (
          <ul className="space-y-0.5">
            <li>
              Kalan yıllık izin: <b>{p.annualWhole} gün</b>
              {p.annualExact !== p.annualWhole && <span className="text-muted-foreground"> (tam: {num(p.annualExact)})</span>}
            </li>
            <li>
              Kullanılmamış hak günü: <b>{p.lieuOpen} gün</b>
            </li>
            <li>
              Günlük ücret (net ÷ 26): <b>{tl(p.dayRate)}</b>
            </li>
            <li className="pt-1 text-base">
              Ödenecek izin: <b>{p.payDays} gün = {tl(p.amount)} ₺</b>
            </li>
            {p.negativeAnnual < 0 && <li className="text-red-700">Yıllık izin {p.negativeAnnual} gün eksiye düşmüş — kesinti kararı sizin.</li>}
            <li className="pt-1 text-xs text-muted-foreground">Çalışma izni, avans ve son ay maaşı Maaşlar › çıkış mutabakatında eklenir.</li>
          </ul>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={sure} onChange={(ev) => setSure(ev.target.checked)} />
        {name} {dateNum(endDate)} itibarıyla ayrılıyor; girişi kapansın.
      </label>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
        <Button variant="destructive" className="flex-1" disabled={!sure || term.isPending} onClick={() => term.mutate({ employeeId: id, endDate, note: note || undefined })}>
          {term.isPending ? <Loader2 className="animate-spin" /> : <UserX />} İşten çıkar
        </Button>
      </div>
    </div>
  );
}
