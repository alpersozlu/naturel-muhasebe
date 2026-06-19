"use client";

import { useForm, Controller, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Building2, Loader2, Trash2, Check, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { trpc } from "@/lib/trpc";
import {
  corporatePurchaseCreateSchema,
  type CorporatePurchaseCreateInput,
} from "@/lib/zod-schemas/corporate-purchase";
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

const TRY_FORMATTER = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function CorporatePurchaseCard({
  storeId,
  date,
}: {
  storeId: string;
  date: string;
}) {
  const disabled = !storeId || !date;
  const utils = trpc.useUtils();

  const { data: rows } = trpc.corporatePurchase.listForStoreDate.useQuery(
    { store_id: storeId, date },
    { enabled: !disabled }
  );

  const invalidate = () => {
    utils.corporatePurchase.listForStoreDate.invalidate({ store_id: storeId, date });
  };

  const create = trpc.corporatePurchase.create.useMutation({
    onSuccess: () => {
      toast.success("Alışveriş kaydedildi");
      invalidate();
      reset({
        store_id: storeId,
        date,
        type: "management",
        company_name: "",
        person_name: "",
        amount: 0,
        currency: "TRY",
        is_paid: false,
        note: "",
      });
    },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.corporatePurchase.delete.useMutation({
    onSuccess: () => {
      toast.success("Silindi");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const setPaid = trpc.corporatePurchase.setPaid.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CorporatePurchaseCreateInput>({
    resolver: zodResolver(
      corporatePurchaseCreateSchema
    ) as Resolver<CorporatePurchaseCreateInput>,
    defaultValues: {
      store_id: storeId,
      date,
      type: "management",
      company_name: "",
      person_name: "",
      amount: 0,
      currency: "TRY",
      is_paid: false,
      note: "",
    },
  });

  const type = useWatch({ control, name: "type" });
  const isCorporate = type === "corporate";

  const onSubmit = (vals: CorporatePurchaseCreateInput) =>
    create.mutateAsync({ ...vals, store_id: storeId, date });

  return (
    <Card className={disabled ? "opacity-50" : ""}>
      <CardContent className="p-5">
        <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-indigo-50 text-indigo-600 mb-3">
          <Building2 className="h-6 w-6" />
        </div>
        <div className="font-medium mb-1">Kurumsal & Yönetim Alışverişi</div>
        <div className="text-xs text-muted-foreground mb-3">
          {disabled
            ? "Önce mağaza ve tarih seç"
            : "Ödemesiz satış — kasa toplamına eklenir"}
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          {/* Tip: Kurumsal / Yönetim */}
          <div>
            <Label className="text-xs">Tür</Label>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => field.onChange("management")}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      field.value === "management"
                        ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                        : "border-border text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    Yönetim
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => field.onChange("corporate")}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      field.value === "corporate"
                        ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                        : "border-border text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    Kurumsal
                  </button>
                </div>
              )}
            />
          </div>

          {/* Kurumsal ise şirket adı (opsiyonel) */}
          {isCorporate ? (
            <div>
              <Label htmlFor="company_name" className="text-xs">
                Şirket Adı (opsiyonel)
              </Label>
              <Input
                id="company_name"
                placeholder="örn. Kaner, Tip-İş, Orhan Şevketler"
                disabled={disabled}
                {...register("company_name")}
              />
            </div>
          ) : null}

          {/* İsim soyisim — her zaman zorunlu */}
          <div>
            <Label htmlFor="person_name" className="text-xs">
              İsim Soyisim <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="person_name"
              placeholder="örn. Mert Ersözlü"
              disabled={disabled}
              {...register("person_name")}
            />
            {errors.person_name ? (
              <p className="text-xs text-destructive mt-1">
                {errors.person_name.message}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="amount" className="text-xs">
                Tutar <span className="text-rose-500">*</span>
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

          {/* Ödeme durumu: Borç / Ödendi */}
          <div>
            <Label className="text-xs">Ödeme Durumu</Label>
            <Controller
              control={control}
              name="is_paid"
              render={({ field }) => (
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => field.onChange(false)}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      field.value === false
                        ? "border-rose-400 bg-rose-50 text-rose-700"
                        : "border-border text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    Borç
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => field.onChange(true)}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      field.value === true
                        ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                        : "border-border text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Ödendi
                  </button>
                </div>
              )}
            />
          </div>

          <div>
            <Label htmlFor="note" className="text-xs">
              Not (opsiyonel)
            </Label>
            <Input
              id="note"
              placeholder="Detay..."
              disabled={disabled}
              {...register("note")}
            />
          </div>

          <Button type="submit" disabled={disabled || isSubmitting} className="w-full">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Kaydet"}
          </Button>
        </form>

        {rows && rows.length > 0 ? (
          <div className="mt-4 pt-3 border-t space-y-2">
            {rows.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2 text-xs bg-indigo-50/40 rounded px-2 py-1.5"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {TRY_FORMATTER.format(Number(r.amount))} {r.currency}
                    {" · "}
                    {r.type === "corporate" ? "Kurumsal" : "Yönetim"}
                  </div>
                  <div className="text-muted-foreground truncate">
                    {r.company_name ? `${r.company_name} — ` : ""}
                    {r.person_name} ·{" "}
                    {formatDistanceToNow(r.created_at, { addSuffix: true, locale: tr })}
                  </div>
                </div>
                {/* Borç/Ödendi rozeti — tıklayınca toggle */}
                <button
                  type="button"
                  onClick={() => setPaid.mutate({ id: r.id, is_paid: !r.is_paid })}
                  title={r.is_paid ? "Ödendi (tıkla: borç yap)" : "Borç (tıkla: ödendi yap)"}
                  className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                    r.is_paid
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-rose-50 text-rose-700 border-rose-200"
                  }`}
                >
                  {r.is_paid ? <Check className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5" />}
                  {r.is_paid ? "Ödendi" : "Borç"}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                  onClick={() => {
                    if (confirm("Bu alışverişi silmek istediğine emin misin?")) {
                      del.mutate({ id: r.id });
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
