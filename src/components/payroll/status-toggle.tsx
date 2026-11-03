"use client";

import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { ComputedLine } from "@/server/services/payroll/period";

/**
 * Aktif yap / Pasif yap (sahibi, 03.11.2026: "bir buton koy, ben aktifleştireyim ya da
 * pasifleştireyim"; aynı gün: "Prim ve mesai girişinde de olsun"). Personel kartındaki
 * durum değişir; açık bütün aylarda geçerlidir. Ayrılan personelde görünmez — çıkış
 * Personel sayfasından verilir.
 */
export function StatusToggleButton({
  line,
  closed,
  onChanged,
  className,
}: {
  line: Pick<ComputedLine, "employee_id" | "full_name" | "employee_status" | "base_salary" | "paid_by_day">;
  closed: boolean;
  onChanged: () => void;
  className?: string;
}) {
  const confirm = useConfirm();
  const setStatus = trpc.payroll.employees.update.useMutation({
    onSuccess: (_r, v) => {
      toast.success(v.status === "active" ? `${line.full_name} aktif yapıldı` : `${line.full_name} pasif yapıldı — bu ay ödeme beklenmez`);
      if (v.status === "active" && !line.paid_by_day && !(line.base_salary > 0))
        toast.info("Baz maaş 0 — bu ayın baz maaşını girip kaydedin.", { duration: 9000 });
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  if (line.employee_status === "left") return null;
  const toActive = line.employee_status === "inactive";
  const toggle = async () => {
    const ok = await confirm({
      title: toActive ? `${line.full_name} aktif yapılsın mı?` : `${line.full_name} pasif yapılsın mı?`,
      description: toActive
        ? "Bu ay çalışıyor sayılır; baz maaş, mesai ve prim hesaplanır. Açık bütün aylarda geçerlidir."
        : "Bu ay çalışmıyor sayılır — ödeme beklenmez (kayıtları silinmez). Açık bütün aylarda geçerlidir; ayrıldıysa Personel sayfasından çıkış verin.",
      confirmLabel: toActive ? "Aktif yap" : "Pasif yap",
    });
    if (ok) setStatus.mutate({ id: line.employee_id, status: toActive ? "active" : "inactive" });
  };
  return (
    <Button
      type="button"
      size="sm"
      variant={toActive ? "default" : "outline"}
      className={cn("h-7 px-2.5 text-xs", className)}
      onClick={toggle}
      disabled={setStatus.isPending || closed}
    >
      {toActive ? "Aktif yap" : "Pasif yap"}
    </Button>
  );
}
