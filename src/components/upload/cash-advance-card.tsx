"use client";

import { useForm, Controller, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Banknote, Loader2, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { trpc } from "@/lib/trpc";
import {
  cashAdvanceCreateSchema,
  type CashAdvanceCreateInput,
} from "@/lib/zod-schemas/cash-advance";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
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
  marketing: "Pazarlama",
  other: "Diğer",
};

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
  const disabled = !storeId || !date;
  const utils = trpc.useUtils();

  const { data: employees } = trpc.user.list.useQuery(undefined, {
    enabled: !disabled,
  });
  const { data: advances } = trpc.cashAdvance.listForStoreDate.useQuery(
    { store_id: storeId, date },
    { enabled: !disabled }
  );

  const create = trpc.cashAdvance.create.useMutation({
    onSuccess: () => {
      toast.success("Peşin ödeme kaydedildi");
      utils.cashAdvance.listForStoreDate.invalidate({ store_id: storeId, date });
      reset({ amount: 0, currency: "TRY", category: "bonus", description: "", employee_id: "", store_id: storeId, date });
    },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.cashAdvance.delete.useMutation({
    onSuccess: () => {
      toast.success("Silindi");
      utils.cashAdvance.listForStoreDate.invalidate({ store_id: storeId, date });
    },
    onError: (e) => toast.error(e.message),
  });

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CashAdvanceCreateInput>({
    resolver: zodResolver(cashAdvanceCreateSchema) as Resolver<CashAdvanceCreateInput>,
    defaultValues: {
      store_id: storeId,
      date,
      employee_id: "",
      amount: 0,
      currency: "TRY",
      category: "bonus",
      description: "",
    },
    values: disabled
      ? undefined
      : {
          store_id: storeId,
          date,
          employee_id: "",
          amount: 0,
          currency: "TRY",
          category: "bonus",
          description: "",
        },
  });

  const onSubmit = (vals: CashAdvanceCreateInput) =>
    create.mutateAsync({ ...vals, store_id: storeId, date });

  return (
    <Card className={disabled ? "opacity-50" : ""}>
      <CardContent className="p-5">
        <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-emerald-50 text-emerald-600 mb-3">
          <Banknote className="h-6 w-6" />
        </div>
        <div className="font-medium mb-1">Peşin Ödeme</div>
        <div className="text-xs text-muted-foreground mb-3">
          {disabled ? "Önce mağaza ve tarih seç" : "Manuel giriş (OCR yok)"}
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="amount" className="text-xs">
                Tutar
              </Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                disabled={disabled}
                {...register("amount", { valueAsNumber: true })}
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

          <div>
            <Label className="text-xs">Çalışan</Label>
            <Controller
              control={control}
              name="employee_id"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={disabled}>
                  <SelectTrigger>
                    <SelectValue placeholder="Çalışan seç" />
                  </SelectTrigger>
                  <SelectContent>
                    {(employees ?? []).map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.full_name ?? u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.employee_id ? (
              <p className="text-xs text-destructive mt-1">{errors.employee_id.message}</p>
            ) : null}
          </div>

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
                  <div className="font-medium truncate">
                    {TRY_FORMATTER.format(Number(a.amount))} {a.currency} · {CATEGORY_LABEL[a.category]}
                  </div>
                  <div className="text-muted-foreground truncate">
                    {a.employee.full_name ?? a.employee.email} ·{" "}
                    {formatDistanceToNow(a.created_at, { addSuffix: true, locale: tr })}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                  onClick={() => {
                    if (confirm("Bu peşin ödemeyi silmek istediğine emin misin?")) {
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
