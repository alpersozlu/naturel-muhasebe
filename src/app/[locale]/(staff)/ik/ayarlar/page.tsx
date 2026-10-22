import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { HrSettings } from "@/components/hr/settings";

export default async function HrSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();
  if (session?.role !== "admin") redirect(`/${locale}/ik`);
  return <HrSettings />;
}
