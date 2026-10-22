import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { HrPeople } from "@/components/hr/people";

export default async function HrPeoplePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();
  if (!session || (session.role !== "admin" && session.role !== "store_manager")) redirect(`/${locale}/ik`);
  return <HrPeople />;
}
