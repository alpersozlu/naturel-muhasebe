"use client";

import { Activity, ArrowRight, Clock, KeyRound, Shield, Store, UserPlus, Users } from "lucide-react";
import type { UserRole } from "@prisma/client";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { trpc } from "@/lib/trpc";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

// Order and labels match user-list.tsx so the two screens read the same.
const ROLE_ORDER: UserRole[] = ["admin", "store_manager", "cashier", "sales_rep"];
const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Yönetici",
  store_manager: "Mağaza Müdürü",
  cashier: "Kasiyer",
  sales_rep: "Satış Temsilcisi",
};
const ROLE_PILL: Record<UserRole, string> = {
  admin: "bg-indigo-50 text-indigo-700 ring-indigo-200/70",
  store_manager: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
  cashier: "bg-amber-50 text-amber-700 ring-amber-200/70",
  sales_rep: "bg-teal-50 text-teal-700 ring-teal-200/70",
};
// Avatar tint by role — the eye finds "the admin" and "the managers" before reading.
const ROLE_AVATAR: Record<UserRole, string> = {
  admin: "from-indigo-500 to-violet-600",
  store_manager: "from-emerald-500 to-teal-600",
  cashier: "from-amber-400 to-orange-500",
  sales_rep: "from-teal-400 to-cyan-500",
};

function initials(name: string | null, email: string): string {
  const src = (name ?? "").trim();
  if (src) {
    const parts = src.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
    return (first + last).toLocaleUpperCase("tr");
  }
  return email.slice(0, 2).toLocaleUpperCase("tr");
}

/**
 * Users, front and centre on the admin portal: who can sign in, with which
 * role, to which store, and when they last did — with the way to change
 * it one click away. This used to be a small grey text link under the
 * stat cards (owner, 29.09.2026).
 */
export function UsersPanel() {
  const { data: users, isLoading } = trpc.user.list.useQuery();
  const { data: logins } = trpc.user.lastLogins.useQuery();

  const all = users ?? [];
  const active = all.filter((u) => u.is_active);
  const inactive = all.length - active.length;
  const countOf = (role: UserRole) => active.filter((u) => u.role === role).length;
  const lastLogin = new Map((logins ?? []).map((l) => [l.email.toLowerCase(), l.at]));

  const sorted = [...all].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    const r = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
    if (r !== 0) return r;
    return (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email, "tr");
  });

  const stats: Array<{ label: string; value: number; tone: string }> = [
    { label: "Aktif kullanıcı", value: active.length, tone: "text-foreground" },
    { label: ROLE_LABEL.admin, value: countOf("admin"), tone: "text-indigo-700" },
    { label: ROLE_LABEL.store_manager, value: countOf("store_manager"), tone: "text-emerald-700" },
    ...(countOf("cashier") + countOf("sales_rep") > 0
      ? [{ label: "Kasiyer / Satış", value: countOf("cashier") + countOf("sales_rep"), tone: "text-amber-700" }]
      : []),
    { label: "Devre dışı", value: inactive, tone: inactive > 0 ? "text-rose-600" : "text-muted-foreground" },
  ];

  return (
    <section className="relative mb-6 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      {/* Soft light, top-right — the panel reads as a place, not a table */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-28 -right-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-36 left-1/4 h-72 w-72 rounded-full bg-violet-200/25 blur-3xl"
      />

      <div className="relative p-5 md:p-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-violet-600 text-white shadow-md shadow-primary/25">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Kullanıcılar</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Sisteme kim girebilir, hangi yetkiyle, hangi mağazaya. Şifre atama, davet,
                devre dışı bırakma ve giriş kayıtları buradan yönetilir.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end shrink-0">
            <Button asChild size="lg" className="gap-2 shadow-md shadow-primary/20">
              <Link href="/admin/users">
                <Users className="h-4 w-4" />
                Kullanıcıları Yönet
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2 bg-background/70">
              <Link href="/admin/users#yeni-kullanici">
                <UserPlus className="h-4 w-4" />
                Yeni kullanıcı
              </Link>
            </Button>
          </div>
        </div>

        {/* Numbers */}
        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/60 bg-border/60 sm:grid-cols-4 lg:grid-cols-5">
          {stats.map((s) => (
            <div key={s.label} className="bg-background/80 px-4 py-3">
              <div className={`text-2xl font-bold tabular-nums tracking-tight ${s.tone}`}>
                {isLoading ? "–" : s.value}
              </div>
              <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* People */}
        {isLoading ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-muted/50" />
            ))}
          </div>
        ) : sorted.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sorted.map((u) => {
              const stores = u.store_access.map((a) => a.store.name);
              const seen = lastLogin.get(u.email.toLowerCase()) ?? null;
              return (
                <Link
                  key={u.id}
                  href="/admin/users"
                  className={`group flex gap-3 rounded-xl border border-border/60 bg-background/80 p-3.5 transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 ${
                    u.is_active ? "" : "opacity-60"
                  }`}
                >
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${ROLE_AVATAR[u.role]} text-sm font-semibold text-white shadow-sm ring-2 ring-white`}
                  >
                    {initials(u.full_name, u.email)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">{u.full_name ?? u.email}</span>
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${u.is_active ? "bg-emerald-500" : "bg-slate-300"}`}
                        title={u.is_active ? "Aktif" : "Devre dışı"}
                      />
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${ROLE_PILL[u.role]}`}
                      >
                        {u.role === "admin" ? <Shield className="h-3 w-3" /> : <Store className="h-3 w-3" />}
                        {ROLE_LABEL[u.role]}
                      </span>
                      {u.role === "admin" ? (
                        <span className="text-[11px] text-muted-foreground">tüm mağazalar</span>
                      ) : stores.length > 0 ? (
                        stores.map((s) => (
                          <span
                            key={s}
                            className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground/80"
                          >
                            {s}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-rose-600">mağaza atanmamış</span>
                      )}
                      {!u.is_active ? (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                          devre dışı
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {seen
                        ? `Son giriş ${formatDistanceToNow(new Date(seen), { addSuffix: true, locale: tr })}`
                        : "Henüz giriş kaydı yok"}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
            Henüz kullanıcı yok — &quot;Yeni kullanıcı&quot; ile ekleyin.
          </div>
        )}

        {/* Secondary */}
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
          <Link href="/admin/users#giris-kayitlari" className="inline-flex items-center gap-1.5 hover:text-primary">
            <KeyRound className="h-3.5 w-3.5" />
            Giriş ve şifre kayıtları
          </Link>
          <Link href="/admin/audit" className="inline-flex items-center gap-1.5 hover:text-primary">
            <Activity className="h-3.5 w-3.5" />
            Aktivite günlüğü — kim, ne zaman, neyi değiştirdi
          </Link>
        </div>
      </div>
    </section>
  );
}
