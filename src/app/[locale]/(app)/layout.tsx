import { Sidebar } from "@/components/layout/sidebar";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { UserMenu } from "@/components/layout/user-menu";
import { getSession } from "@/lib/auth/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

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
