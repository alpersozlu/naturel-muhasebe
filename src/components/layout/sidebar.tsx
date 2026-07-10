"use client";

import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  Shield,
  ClipboardCheck,
  ShieldAlert,
  ScrollText,
  TrendingUp,
  BarChart3,
  Wallet,
  Upload,
  History,
  Mail,
  ShoppingCart,
  Building2,
  FileSpreadsheet,
  Ticket,
  Footprints,
} from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";
import { NrLogo } from "@/components/brand/nr-logo";

const NAV_ADMIN = [
  { href: "/", icon: LayoutDashboard, key: "today" as const },
  { href: "/admin", icon: Shield, key: "admin" as const },
  { href: "/verification", icon: ClipboardCheck, key: "verification" as const },
  { href: "/cash-variance", icon: ShieldAlert, key: "cashVariance" as const },
  { href: "/z-analysis", icon: ScrollText, key: "zAnalysis" as const },
  { href: "/revenues", icon: TrendingUp, key: "revenues" as const },
  { href: "/expenses", icon: BarChart3, key: "expenses" as const },
  { href: "/invoiced-expense", icon: FileSpreadsheet, key: "invoicedExpense" as const },
  { href: "/advances", icon: Wallet, key: "advances" as const },
  { href: "/shopping-vouchers", icon: Ticket, key: "shoppingVouchers" as const },
  { href: "/corporate", icon: Building2, key: "corporate" as const },
  { href: "/upload", icon: Upload, key: "upload" as const },
  { href: "/history", icon: History, key: "history" as const },
  { href: "/nebim-sales", icon: ShoppingCart, key: "nebimSales" as const },
  { href: "/people-count", icon: Footprints, key: "peopleCount" as const },
  { href: "/contact", icon: Mail, key: "contact" as const },
] as const;

// Admin dışı kullanıcılar (mağaza müdürü, kasiyer, satış temsilcisi)
// sadece kendi mağazalarına belge yükleyebilir. Diğer sayfalar gizli.
const NAV_NON_ADMIN = [
  { href: "/upload", icon: Upload, key: "upload" as const },
  { href: "/contact", icon: Mail, key: "contact" as const },
] as const;

export function Sidebar({ role }: { role: UserRole | null }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const NAV = role === "admin" ? NAV_ADMIN : NAV_NON_ADMIN;

  return (
    <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 border-r border-border/70 bg-card/95 backdrop-blur-sm">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-border/70">
        <NrLogo className="h-10 w-10 shrink-0" />
        <div className="min-w-0">
          <div className="font-semibold leading-tight tracking-tight">
            Naturel Ticaret
          </div>
          <div className="text-xs text-muted-foreground">
            Muhasebe · Yapay Zeka
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ href, icon: Icon, key }) => {
          const active =
            href === "/"
              ? pathname === "/"
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-snap ease-ios active:scale-[0.98]",
                active
                  ? "bg-primary/10 text-primary shadow-xs"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              )}
            >
              <Icon
                className={cn(
                  "h-5 w-5 shrink-0 transition-transform duration-snap ease-snappy",
                  active ? "scale-105" : "group-hover:scale-105"
                )}
              />
              <span>{t(key)}</span>
              {active ? (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r-full bg-primary" />
              ) : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
