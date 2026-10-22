"use client";

import { useState } from "react";
import { CalendarDays, Clock, Home, ListChecks, Palmtree, Plus, Sun, UserRound, X } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

/**
 * TELEFON ALT MENÜSÜ — uygulama gibi: Ana sayfa · Ajanda · ➕ · Taleplerim ·
 * Hesabım. Ortadaki ➕ üç işi açar (pazar / izin / mesai), her yerden tek
 * dokunuş. Geniş ekranda gizli (orada üst sekmeler var).
 */
export function BottomBar() {
  const pathname = usePathname();
  const [sheet, setSheet] = useState(false);
  const me = trpc.hr.me.useQuery(undefined, { staleTime: 30_000 });
  const waiting = me.data?.mine?.requests.filter((r) => r.status === "waiting").length ?? 0;
  const tab = (href: string, label: string, icon: React.ReactNode, badge = 0) => {
    const active = href === "/ik" ? pathname === "/ik" : pathname.startsWith(href);
    return (
      <Link href={href} className={cn("relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-indigo-600" : "text-slate-500")}>
        {icon}
        {label}
        {badge > 0 && <span className="absolute right-[22%] top-1 rounded-full bg-red-500 px-1.5 text-[10px] text-white">{badge}</span>}
      </Link>
    );
  };

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-lg items-end">
          {tab("/ik", "Ana sayfa", <Home className="h-6 w-6" />)}
          {tab("/ik/ajanda", "Ajanda", <CalendarDays className="h-6 w-6" />)}
          <div className="flex flex-1 justify-center">
            <button
              type="button"
              onClick={() => setSheet(true)}
              aria-label="Yeni talep"
              className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 active:scale-95"
            >
              <Plus className="h-7 w-7" />
            </button>
          </div>
          {tab("/ik/talepler", "Taleplerim", <ListChecks className="h-6 w-6" />, waiting)}
          {tab("/ik/hesabim", "Hesabım", <UserRound className="h-6 w-6" />)}
        </div>
      </nav>

      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setSheet(false)}>
          <div className="w-full rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-semibold">Ne yapmak istiyorsunuz?</div>
              <button type="button" onClick={() => setSheet(false)} aria-label="Kapat">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-2">
              <SheetAction href="/ik?form=worked" cls="bg-amber-500" icon={<Sun className="h-6 w-6" />} title="Pazar / bayram çalıştım" text="1 gün izin kazanırsınız" onGo={() => setSheet(false)} />
              <SheetAction href="/ik?form=leave" cls="bg-emerald-600" icon={<Palmtree className="h-6 w-6" />} title="İzin istiyorum" text="Hak günü, yıllık izin, hastalık…" onGo={() => setSheet(false)} />
              <SheetAction href="/ik?form=overtime" cls="bg-indigo-600" icon={<Clock className="h-6 w-6" />} title="Mesai yazdım" text="Fazla çalıştıysanız" onGo={() => setSheet(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SheetAction({ href, cls, icon, title, text, onGo }: { href: string; cls: string; icon: React.ReactNode; title: string; text: string; onGo: () => void }) {
  return (
    <Link href={href} onClick={onGo} className={cn("flex items-center gap-4 rounded-2xl p-4 text-white", cls)}>
      <span className="rounded-full bg-white/20 p-2.5">{icon}</span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm opacity-90">{text}</span>
      </span>
    </Link>
  );
}
