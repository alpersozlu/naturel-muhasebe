"use client";

import { Activity, ArrowRight, Shield, Store, UserPlus, Users } from "lucide-react";
import type { UserRole } from "@prisma/client";
import { trpc } from "@/lib/trpc";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// Order and labels match user-list.tsx so the two screens read the same.
const ROLE_ORDER: UserRole[] = ["admin", "store_manager", "cashier", "sales_rep"];
const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Yönetici",
  store_manager: "Mağaza Müdürü",
  cashier: "Kasiyer",
  sales_rep: "Satış Temsilcisi",
};
const ROLE_BADGE: Record<UserRole, string> = {
  admin: "bg-indigo-100 text-indigo-700",
  store_manager: "bg-emerald-100 text-emerald-700",
  cashier: "bg-amber-100 text-amber-700",
  sales_rep: "bg-teal-100 text-teal-700",
};

const PREVIEW_ROWS = 6;

/**
 * Users, front and centre on the admin portal. Who can sign in, with which
 * role, to which store — and the way to change it — used to be a small
 * grey text link under the stat cards (owner, 29.09.2026: "neredeyse
 * görünmez saklanmış ama en önemli yerlerden biri").
 */
export function UsersPanel() {
  const { data: users, isLoading } = trpc.user.list.useQuery();

  const all = users ?? [];
  const active = all.filter((u) => u.is_active);
  const inactive = all.length - active.length;
  const byRole = ROLE_ORDER.map((role) => ({
    role,
    count: active.filter((u) => u.role === role).length,
  })).filter((r) => r.count > 0);

  const preview = [...all]
    .sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      const r = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
      if (r !== 0) return r;
      return (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email, "tr");
    })
    .slice(0, PREVIEW_ROWS);
  const more = all.length - preview.length;

  return (
    <Card className="mb-6 border-primary/20 bg-gradient-to-br from-primary/[0.04] to-transparent">
      <CardContent className="pt-5 pb-5">
        {/* Header: what this is + the main action */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold leading-tight">Kullanıcılar</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Sisteme kim girebilir, hangi yetkiyle, hangi mağazaya — hepsi burada.
                Şifre atama, davet gönderme, devre dışı bırakma ve giriş kayıtları.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end shrink-0">
            <Button asChild size="lg" className="gap-2">
              <Link href="/admin/users">
                <Users className="h-4 w-4" />
                Kullanıcıları Yönet
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2">
              <Link href="/admin/users#yeni-kullanici">
                <UserPlus className="h-4 w-4" />
                Yeni kullanıcı
              </Link>
            </Button>
          </div>
        </div>

        {/* Counts by role */}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          {isLoading ? (
            <span className="text-muted-foreground">Yükleniyor…</span>
          ) : (
            <>
              <span className="font-medium text-foreground/80">
                {active.length} aktif kullanıcı
              </span>
              {byRole.map(({ role, count }) => (
                <span
                  key={role}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${ROLE_BADGE[role]}`}
                >
                  {count} {ROLE_LABEL[role]}
                </span>
              ))}
              {inactive > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium bg-slate-100 text-slate-600">
                  {inactive} devre dışı
                </span>
              ) : null}
            </>
          )}
        </div>

        {/* Who — compact preview, the full list is one click away */}
        {preview.length > 0 ? (
          <div className="mt-4 rounded-lg border border-border/60 bg-background/70 divide-y divide-border/50">
            {preview.map((u) => {
              const stores = u.store_access.map((a) => a.store.name);
              return (
                <Link
                  key={u.id}
                  href="/admin/users"
                  className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
                >
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${
                      u.is_active ? "bg-emerald-500" : "bg-slate-300"
                    }`}
                    title={u.is_active ? "Aktif" : "Devre dışı"}
                  />
                  <span className={`min-w-0 flex-1 truncate ${u.is_active ? "" : "text-muted-foreground line-through"}`}>
                    <span className="font-medium">{u.full_name ?? u.email}</span>
                    {u.full_name ? (
                      <span className="text-muted-foreground"> · {u.email}</span>
                    ) : null}
                  </span>
                  <span
                    className={`hidden sm:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 ${ROLE_BADGE[u.role]}`}
                  >
                    {u.role === "admin" ? <Shield className="h-3 w-3" /> : <Store className="h-3 w-3" />}
                    {ROLE_LABEL[u.role]}
                  </span>
                  <span className="hidden md:block text-xs text-muted-foreground truncate max-w-[220px] shrink-0">
                    {u.role === "admin" ? "tüm mağazalar" : stores.length ? stores.join(", ") : "mağaza atanmamış"}
                  </span>
                </Link>
              );
            })}
            {more > 0 ? (
              <Link
                href="/admin/users"
                className="block px-3 py-2 text-xs text-primary hover:underline"
              >
                +{more} kullanıcı daha — tümünü gör
              </Link>
            ) : null}
          </div>
        ) : null}

        {/* Secondary */}
        <div className="mt-3">
          <Link
            href="/admin/audit"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
          >
            <Activity className="h-3.5 w-3.5" />
            Aktivite günlüğü — kim, ne zaman, neyi değiştirdi
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
