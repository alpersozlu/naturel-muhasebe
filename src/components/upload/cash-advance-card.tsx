"use client";

import { useForm, Controller, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Banknote, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { trpc } from "@/lib/trpc";
import {
  cashAdvanceFormSchema,
  type CashAdvanceFormInput,
} from "@/lib/zod-schemas/cash-advance";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SUPPORTED_CURRENCIES } from "@/lib/constants";

const CATEGORY_LABEL: Record<string, string> = {
  rent: "Kira",
  electricity: "Elektrik",
  water: "Su",
  internet: "İnternet",
  stationery: "Kırtasiye",
  cleaning: "Temizlik",
  maintenance: "Bakım",
  salary: "Maaş",
  bonus: "Prim/Avans",
  supplies: "Sarf Malzeme",
  food: "Yemek",
  marketing: "Pazarlama",
  labor: "İşçi Parası",
  tailor: "Terzi",
  glazier: "Camcı",
  other: "Diğer",
};

const STAFF_ROLE_LABEL: Record<string, string> = {
  manager: "Müdür",
  assistant_manager: "Müdür Yardımcısı",
  sales_staff: "Satış Elemanı",
};

/** Ödeme bordroya DÜŞMEDİYSE nedeni — sessiz kalmasın. */
function payrollHint(reason: string): string {
  switch (reason) {
    case "no_person":
      return "Bordroda bu isim bulunamadı; Maaşlar › Avans adımından elle aktarılacak.";
    case "no_period":
    case "no_line":
      return "Bu ayın bordrosu henüz açılmadı; dönem açılınca kendiliğinden işlenecek.";
    case "period_closed":
      return "Bu ayın bordrosu kapalı — Maaşlar'dan ayı yeniden açıp aktarın.";
    default:
      return "Bordroya işlenemedi; Maaşlar › Avans adımından kontrol edin.";
  }
}

const TRY_FORMATTER = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function CashAdvanceCard({
  storeId,
  date,
}: {
  storeId: string;
  date: string;
}) {
  const confirmDialog = useConfirm();
  const disabled = !storeId || !date;
  const utils = trpc.useUtils();

  // user.list is admin-only; a manager's page must not fire it (FORBIDDEN
  // on every load, empty dropdown).
  const { data: me } = trpc.user.me.useQuery();
  const { data: employees } = trpc.user.list.useQuery(undefined, {
    enabled: !disabled && me?.role === "admin",
  });
  // Maaş / Prim-Avans'ta kişi mağazanın bordro kadrosundan seçilir; ödeme
  // o kişinin o ayki bordrosuna kendiliğinden düşer.
  const { data: staff } = trpc.cashAdvance.staffOptions.useQuery(
    { store_id: storeId },
    { enabled: !disabled }
  );
  const { data: advances } = trpc.cashAdvance.listForStoreDate.useQuery(
    { store_id: storeId, date },
    { enabled: !disabled }
  );

  const create = trpc.cashAdvance.create.useMutation({
    onSuccess: (r) => {
      const p = r.payroll;
      if (p?.linked) {
        toast.success(`Peşin ödeme kaydedildi — ${p.employee_name} adına ${p.period} bordrosuna işlendi`);
      } else if (p && p.reason !== "not_payroll") {
        toast.success("Peşin ödeme kaydedildi", { description: payrollHint(p.reason) });
      } else {
        toast.success("Peşin ödeme kaydedildi");
      }
      setManualName(false);
      utils.cashAdvance.listForStoreDate.invalidate({ store_id: storeId, date });
      utils.dailyRecord.entriesForStoreDate.invalidate({ store_id: storeId, date });
      reset({
        amount: 0,
        currency: "TRY",
        category: "bonus",
        description: "",
        employee_id: "",
        staff_role: undefined,
        staff_name: "",
        payroll_employee_id: "",
      });
    },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.cashAdvance.delete.useMutation({
    onSuccess: () => {
      toast.success("Silindi");
      utils.cashAdvance.listForStoreDate.invalidate({ store_id: storeId, date });
      utils.dailyRecord.entriesForStoreDate.invalidate({ store_id: storeId, date });
    },
    onError: (e) => toast.error(e.message),
  });

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CashAdvanceFormInput>({
    resolver: zodResolver(cashAdvanceFormSchema) as Resolver<CashAdvanceFormInput>,
    defaultValues: {
      employee_id: "",
      amount: 0,
      currency: "TRY",
      category: "bonus",
      description: "",
      staff_role: undefined,
      staff_name: "",
      payroll_employee_id: "",
    },
  });

  // Maaş ve Prim/Avans kişiye bağlıdır — bordroya o kişi adına düşer.
  const category = useWatch({ control, name: "category" });
  const isPersonal = category === "bonus" || category === "salary";
  // Bordro kadrosunda olmayan biri (dışarıdan, yeni başlayan) için elle isim.
  const [manualName, setManualName] = useState(false);
  const useList = isPersonal && !manualName && (staff ?? []).length > 0;
  const pickedId = useWatch({ control, name: "payroll_employee_id" });
  const picked = (staff ?? []).find((p) => p.id === pickedId) ?? null;
  // Kadro mağaza mağaza gruplanır; ödemenin yapıldığı mağaza başta.
  const staffGroups = (() => {
    const out: { store_name: string; same_store: boolean; people: NonNullable<typeof staff> }[] = [];
    for (const p of staff ?? []) {
      const last = out[out.length - 1];
      if (last && last.store_name === p.store_name) last.people.push(p);
      else out.push({ store_name: p.store_name, same_store: p.same_store, people: [p] });
    }
    return out;
  })();

  // store_id ve date form alanı değil — prop olarak gelir, submit anında eklenir.
  // Bu sayede prop değişimine bağlı stale form state sorunu yaşanmaz.
  const onSubmit = (vals: CashAdvanceFormInput) => {
    if (!storeId || !date) {
      toast.error("Mağaza ve tarih seçilmedi");
      return;
    }
    const clean: CashAdvanceFormInput = useList
      ? { ...vals, staff_name: "", staff_role: undefined }
      : { ...vals, payroll_employee_id: "" };
    return create.mutateAsync({ ...clean, store_id: storeId, date });
  };

  return (
    <Card className={disabled ? "opacity-50" : ""}>
      <CardContent className="p-5">
        <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-emerald-50 text-emerald-600 mb-3">
          <Banknote className="h-6 w-6" />
        </div>
        <div className="font-medium mb-1">Faturasız Peşin Ödeme</div>
        <div className="text-xs text-muted-foreground mb-3">
          {disabled ? "Önce mağaza ve tarih seç" : "Manuel giriş (OCR yok)"}
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="amount" className="text-xs">
                Tutar
              </Label>
              <Controller
                control={control}
                name="amount"
                render={({ field }) => (
                  <MoneyInput
                    id="amount"
                    placeholder="0"
                    disabled={disabled}
                    // amount şemada z.coerce.number() — form INPUT tipi unknown.
                    value={
                      typeof field.value === "number" ? field.value : undefined
                    }
                    onChange={field.onChange}
                  />
                )}
              />
              {errors.amount ? (
                <p className="text-xs text-destructive mt-1">{errors.amount.message}</p>
              ) : null}
            </div>
            <div>
              <Label className="text-xs">Para Birimi</Label>
              <Controller
                control={control}
                name="currency"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={disabled}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Kategori</Label>
            <Controller
              control={control}
              name="category"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={disabled}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {useList ? (
            <div>
              <Label className="text-xs">
                Kime ödendi? <span className="text-rose-500">*</span>
              </Label>
              <Controller
                control={control}
                name="payroll_employee_id"
                render={({ field }) => (
                  <Select
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                    disabled={disabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Personel seç" />
                    </SelectTrigger>
                    <SelectContent>
                      {staffGroups.map((g) => (
                        <SelectGroup key={g.store_name}>
                          <SelectLabel className="text-xs text-muted-foreground">
                            {g.same_store ? g.store_name : `${g.store_name} (başka mağaza)`}
                          </SelectLabel>
                          {g.people.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.full_name} — {p.position}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.staff_name ? (
                <p className="text-xs text-destructive mt-1">{errors.staff_name.message}</p>
              ) : null}
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground leading-snug">
                  {picked && !picked.same_store
                    ? `${picked.store_name} kadrosu — kendi bordrosundan düşülür.`
                    : category === "salary"
                      ? "Bu ayki maaşından düşülür."
                      : "Bu ayki maaşından avans olarak düşülür."}
                </p>
                <button
                  type="button"
                  onClick={() => setManualName(true)}
                  className="shrink-0 text-xs font-medium text-primary hover:underline"
                >
                  Listede yok
                </button>
              </div>
            </div>
          ) : isPersonal ? (
            <>
              {/* Kadroda olmayan kişi: rol + isim elle */}
              <div>
                <Label className="text-xs">
                  Personel Rolü <span className="text-rose-500">*</span>
                </Label>
                <Controller
                  control={control}
                  name="staff_role"
                  render={({ field }) => (
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                      disabled={disabled}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Rol seç" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(STAFF_ROLE_LABEL).map(([k, v]) => (
                          <SelectItem key={k} value={k}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.staff_role ? (
                  <p className="text-xs text-destructive mt-1">
                    {errors.staff_role.message}
                  </p>
                ) : null}
              </div>
              <div>
                <Label htmlFor="staff_name" className="text-xs">
                  İsim Soyisim <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="staff_name"
                  placeholder="örn. Ahmet Yılmaz"
                  disabled={disabled}
                  {...register("staff_name")}
                />
                {errors.staff_name ? (
                  <p className="text-xs text-destructive mt-1">
                    {errors.staff_name.message}
                  </p>
                ) : null}
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground leading-snug">
                    Kadroda bulunursa kendiliğinden işlenir.
                  </p>
                  {(staff ?? []).length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setManualName(false)}
                      className="shrink-0 text-xs font-medium text-primary hover:underline"
                    >
                      Listeden seç
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <div>
              <Label className="text-xs">Çalışan (opsiyonel)</Label>
              <Controller
                control={control}
                name="employee_id"
                render={({ field }) => (
                  <Select
                    value={field.value || "_none"}
                    onValueChange={(v) => field.onChange(v === "_none" ? "" : v)}
                    disabled={disabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Çalışan seç (opsiyonel)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Çalışan yok</SelectItem>
                      {(employees ?? []).map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.full_name ?? u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          )}

          <div>
            <Label htmlFor="description" className="text-xs">
              Açıklama (opsiyonel)
            </Label>
            <Input
              id="description"
              placeholder="Detay..."
              disabled={disabled}
              {...register("description")}
            />
          </div>

          <Button type="submit" disabled={disabled || isSubmitting} className="w-full">
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Kaydet"
            )}
          </Button>
        </form>

        {advances && advances.length > 0 ? (
          <div className="mt-4 pt-3 border-t space-y-2">
            {advances.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 text-xs bg-emerald-50/50 rounded px-2 py-1.5"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium truncate">
                      {TRY_FORMATTER.format(Number(a.amount))} {a.currency} · {CATEGORY_LABEL[a.category]}
                    </span>
                    {a.payroll_linked ? (
                      <span className="shrink-0 rounded border border-emerald-200 bg-white px-1 py-px text-xs font-medium text-emerald-800">
                        Bordroda
                      </span>
                    ) : a.payroll_pending ? (
                      <span className="shrink-0 rounded border border-amber-200 bg-white px-1 py-px text-xs font-medium text-amber-800">
                        Bordroya işlenmedi
                      </span>
                    ) : null}
                  </div>
                  <div className="text-muted-foreground truncate">
                    {a.staff_name
                      ? `${a.staff_name}${a.staff_role ? ` (${STAFF_ROLE_LABEL[a.staff_role] ?? a.staff_role})` : ""}`
                      : a.employee?.full_name ?? a.employee?.email ?? "Çalışan yok"}{" "}
                    ·{" "}
                    {formatDistanceToNow(a.created_at, { addSuffix: true, locale: tr })}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                  onClick={async () => {
                    if (
                      await confirmDialog({
                        title: "Peşin ödeme silinsin mi?",
                        description: a.payroll_linked
                          ? "Bu kayıt kaldırılır; kişinin bordrosundaki karşılığı da silinir."
                          : "Bu faturasız peşin ödeme kaydı kaldırılır.",
                        confirmLabel: "Sil",
                        destructive: true,
                      })
                    ) {
                      del.mutate({ id: a.id });
                    }
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
