import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { HrApprovals } from "@/components/hr/approvals";

export default async function HrApprovalsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();
  if (!session || (session.role !== "admin" && session.role !== "store_manager")) redirect(`/${locale}/ik`);
  return <HrApprovals />;
}
