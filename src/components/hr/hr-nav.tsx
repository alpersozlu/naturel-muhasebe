"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

/** Müdür ve sahibi için sekmeler; personel sekme görmez (tek ekranı var). */
export function HrNav({ admin }: { admin: boolean }) {
  const pathname = usePathname();
  const me = trpc.hr.me.useQuery(undefined, { staleTime: 30_000 });
  const tabs = [
    { href: "/ik", label: "Benim" },
    { href: "/ik/ajanda", label: "Ajanda" },
    { href: "/ik/onay", label: "Onaylar", badge: me.data?.pending ?? 0 },
    { href: "/ik/personel", label: "Personel" },
    ...(admin ? [{ href: "/ik/ayarlar", label: "Ayarlar" }] : []),
    { href: admin ? "/payroll" : "/upload", label: "Muhasebe ↗" },
  ];
  return (
    <nav className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-2 pb-2">
      {tabs.map((t) => {
        const active = t.href === "/ik" ? pathname === "/ik" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium",
              active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            )}
          >
            {t.label}
            {"badge" in t && t.badge ? <span className="rounded-full bg-red-500 px-1.5 text-xs text-white">{t.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
