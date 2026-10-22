import type { Metadata, Viewport } from "next";
import { getSession } from "@/lib/auth/session";
import { DisabledAccount } from "@/components/layout/disabled-account";
import { UserMenu } from "@/components/layout/user-menu";
import { NrLogo } from "@/components/brand/nr-logo";
import { HrNav } from "@/components/hr/hr-nav";
import { BottomBar } from "@/components/hr/bottom-bar";

export const metadata: Metadata = {
  title: "Naturel İK",
  description: "İzin, pazar çalışması ve mesai",
  manifest: "/ik.webmanifest",
  appleWebApp: { capable: true, title: "Naturel İK", statusBarStyle: "default" },
  icons: { apple: "/ik-icon-180.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f172a" };

/**
 * NATUREL İK kabuğu — telefon önce. Muhasebe'nin yan menülü düzeninden ayrı:
 * personel (role "staff") yalnız burayı görür. Veri güvenliği tRPC'de
 * (hr router): herkes yalnız kendi kaydını, müdür kendi mağazasını görür.
 */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) return <DisabledAccount />;
  const isManager = session.role === "admin" || session.role === "store_manager";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <NrLogo className="h-8 w-8 shrink-0" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="font-semibold">Naturel İK</div>
            <div className="text-xs text-muted-foreground">İzin · pazar · mesai</div>
          </div>
          <UserMenu email={session.email} name={session.full_name} />
        </div>
        {isManager && <HrNav admin={session.role === "admin"} />}
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5 pb-28 md:pb-16">{children}</main>
      <BottomBar />
    </div>
  );
}
