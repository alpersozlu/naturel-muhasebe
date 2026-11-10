import { Link } from "@/i18n/navigation";
import { PayrollPeriodPage } from "@/components/payroll/period-page";

export const dynamic = "force-dynamic";

/** Eski Maaşlar görünümü — yeni düzene alışma süresince yedek olarak durur. */
export default function PayrollClassicPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-950">
        <span>Bu, Maaşlar sayfasının eski görünümü. Veriler aynıdır; yalnız düzen farklıdır.</span>
        <Link href="/payroll" className="ml-auto font-medium underline underline-offset-2">
          Yeni görünüme dön
        </Link>
      </div>
      <PayrollPeriodPage />
    </div>
  );
}
