"use client";

import { useTranslations } from "next-intl";
import {
  Shield,
  ClipboardCheck,
  TrendingUp,
  BarChart3,
  Upload,
  History,
  Mail,
} from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", icon: Shield, key: "admin" as const },
  { href: "/verification", icon: ClipboardCheck, key: "verification" as const },
  { href: "/revenues", icon: TrendingUp, key: "revenues" as const },
  { href: "/expenses", icon: BarChart3, key: "expenses" as const },
  { href: "/upload", icon: Upload, key: "upload" as const },
  { href: "/history", icon: History, key: "history" as const },
  { href: "/contact", icon: Mail, key: "contact" as const },
] as const;

export function Sidebar() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 border-r bg-card">
      <div className="flex items-center gap-3 px-6 py-6 border-b">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold shrink-0">
          NT
        </div>
        <div className="min-w-0">
          <div className="font-semibold leading-tight">Naturel Ticaret</div>
          <div className="text-xs text-muted-foreground">Muhasebe · Yapay Zeka</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map(({ href, icon: Icon, key }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span>{t(key)}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
