import { redirect } from "@/i18n/navigation";

export default async function LocaleHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/admin", locale: locale as "tr" | "en" });
}
