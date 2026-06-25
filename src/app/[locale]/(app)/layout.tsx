import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { UserMenu } from "@/components/layout/user-menu";
import { getSession } from "@/lib/auth/session";

// ALLOWLIST (varsayılan-yasak): admin DIŞI kullanıcılar SADECE bu yollara
// erişebilir; diğer her şey kapalıdır. Yeni eklenen herhangi bir sayfa
// otomatik olarak admin-dışına KAPALI kalır (blocklist'te unutma riski yok).
// - /upload: kendi mağazasına belge/gün kaydı yükleme (Yükle ve Analiz Et)
// - /contact: iletişim (iş verisi içermez; mağazasız müdür için fallback)
const NON_ADMIN_ALLOWED = ["/upload", "/contact"];

const LOCALE_RE = /^\/(tr|en)(\/|$)/;

function stripLocale(pathname: string): { locale: string; path: string } {
  const m = pathname.match(LOCALE_RE);
  if (m) {
    return {
      locale: m[1] ?? "tr",
      path: pathname.replace(m[0], "/"),
    };
  }
  return { locale: "tr", path: pathname || "/" };
}

function isAllowedForNonAdmin(noLocale: string): boolean {
  return NON_ADMIN_ALLOWED.some(
    (p) => noLocale === p || noLocale.startsWith(`${p}/`)
  );
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const hdrs = headers();
  const pathname = hdrs.get("x-pathname") ?? "/";
  const { locale, path } = stripLocale(pathname);

  // Admin dışı kullanıcı izinli olmayan bir rotaya girerse → /upload'a yönlendir.
  // Sidebar gizlemenin ötesinde URL'i direkt girene karşı koruma (default-deny).
  if (session && session.role !== "admin" && !isAllowedForNonAdmin(path)) {
    redirect(`/${locale}/upload`);
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar role={session?.role ?? null} />
      <div className="md:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-end gap-3 border-b bg-card/95 backdrop-blur px-6">
          <LanguageSwitcher />
          {session ? (
            <UserMenu email={session.email} name={session.full_name} />
          ) : null}
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
