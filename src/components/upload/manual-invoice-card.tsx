"use client";

import { useEffect } from "react";
import { useForm, Controller, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { FileSignature, Loader2, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { trpc } from "@/lib/trpc";
import {
  manualInvoiceCreateSchema,
  type ManualInvoiceCreateInput,
} from "@/lib/zod-schemas/manual-invoice";
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

export function ManualInvoiceCard({
  storeId,
  date,
}: {
  storeId: string;
  date: string;
}) {
  const disabled = !storeId || !date;
  const utils = trpc.useUtils();

  const { data: invoices } = trpc.manualInvoice.listForStoreDate.useQuery(
    { store_id: storeId, date },
    { enabled: !disabled }
  );

  const create = trpc.manualInvoice.create.useMutation({
    onSuccess: () => {
      toast.success("El faturası kaydedildi");
      utils.manualInvoice.listForStoreDate.invalidate({
        store_id: storeId,
        date,
      });
      // Z raporu durumunu güncelle (mevcut Z varsa kural yeniden değerlendirilebilir)
      utils.upload.listForStoreDate.invalidate({ store_id: storeId, date });
      reset({
        store_id: storeId,
        date,
        amount: 0,
        currency: "TRY",
        invoice_no: "",
        invoice_date: "",
        description: "",
      });
    },
    onError: (e) => {
      // Debug için tam hata
      if (typeof window !== "undefined") {
        console.error("Manuel fatura mutation error:", e);
      }
      // tRPC zod hatalarını JSON'dan ayıkla — okunaklı göster
      let msg = e.message;
      try {
        const parsed = JSON.parse(msg);
        if (Array.isArray(parsed) && parsed.length > 0) {
          msg = parsed
            .map((i) => {
              const path = Array.isArray(i.path) ? i.path.join(".") : "";
              return path ? `${path}: ${i.message}` : i.message;
            })
            .join(" · ");
        }
      } catch {
        /* zod JSON değil — düz mesaj olarak göster */
      }
      toast.error(msg);
    },
  });

  const del = trpc.manualInvoice.delete.useMutation({
    onSuccess: () => {
      toast.success("Silindi");
      utils.manualInvoice.listForStoreDate.invalidate({
        store_id: storeId,
        date,
      });
      utils.upload.listForStoreDate.invalidate({ store_id: storeId, date });
    },
    onError: (e) => toast.error(e.message),
  });

  const {
    register,
    handleSubmit,
    reset,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ManualInvoiceCreateInput>({
    resolver: zodResolver(
      manualInvoiceCreateSchema
    ) as Resolver<ManualInvoiceCreateInput>,
    defaultValues: {
      store_id: storeId,
      date,
      amount: 0,
      currency: "TRY",
      invoice_no: "",
      invoice_date: "",
      description: "",
    },
  });

  // storeId/date prop'ları değiştiğinde form değerlerini güncelle.
  // defaultValues sadece ilk render'da uygulandığı için, sonradan seçilen
  // mağaza/tarih form içine yansımıyordu — validation "Mağaza seçilmedi" diyordu.
  useEffect(() => {
    setValue("store_id", storeId);
    setValue("date", date);
  }, [storeId, date, setValue]);

  const onSubmit = (vals: ManualInvoiceCreateInput) =>
    create.mutateAsync({ ...vals, store_id: storeId, date });

  // Validation hatalarını sessiz bırakmamak için — kullanıcı neden kaydedemediğini görsün
  const FIELD_LABELS: Record<string, string> = {
    store_id: "Mağaza",
    date: "Gün tarihi",
    amount: "Tutar",
    currency: "Para birimi",
    invoice_no: "Fatura no",
    invoice_date: "Fatura tarihi",
    description: "Açıklama",
  };
  const onInvalid = (errs: Record<string, { message?: string }>) => {
    if (typeof window !== "undefined") {
      // Console'da net görmek için — debug'ta kullanılır
      console.warn("Manuel fatura validation errors:", errs);
    }
    const entries = Object.entries(errs);
    if (entries.length === 0) {
      toast.error("Lütfen tüm zorunlu alanları doldurun");
      return;
    }
    const [field, err] = entries[0]!;
    const label = FIELD_LABELS[field] ?? field;
    const msg = err?.message ?? "geçersiz değer";
    toast.error(`${label}: ${msg}`);
  };

  return (
    <Card className={disabled ? "opacity-50" : ""}>
      <CardContent className="p-5">
        <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-orange-50 text-orange-600 mb-3">
          <FileSignature className="h-6 w-6" />
        </div>
        <div className="font-medium mb-1">El Faturası</div>
        <div className="text-xs text-muted-foreground mb-3">
          {disabled ? "Önce mağaza ve tarih seç" : "Manuel giriş (OCR yok)"}
        </div>

        <form
          onSubmit={handleSubmit(onSubmit, onInvalid)}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="mi-amount" className="text-xs">
                Tutar <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="mi-amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="örn. 1500,00"
                disabled={disabled}
                {...register("amount", { valueAsNumber: true })}
              />
              {errors.amount ? (
                <p className="text-xs text-destructive mt-1">
                  {errors.amount.message}
                </p>
              ) : null}
            </div>
            <div>
              <Label className="text-xs">Para Birimi</Label>
              <Controller
                control={control}
                name="currency"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={disabled}
                  >
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

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="mi-no" className="text-xs">
                Fatura No (opsiyonel)
              </Label>
              <Input id="mi-no" disabled={disabled} {...register("invoice_no")} />
            </div>
            <div>
              <Label htmlFor="mi-date" className="text-xs">
                Tarih (opsiyonel)
              </Label>
              <Input
                id="mi-date"
                type="date"
                disabled={disabled}
                {...register("invoice_date")}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="mi-desc" className="text-xs">
              Açıklama (opsiyonel)
            </Label>
            <Input
              id="mi-desc"
              placeholder="Müşteri adı, ürün..."
              disabled={disabled}
              {...register("description")}
            />
          </div>

          <Button
            type="submit"
            disabled={disabled || isSubmitting}
            className="w-full"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Kaydet"
            )}
          </Button>
        </form>

        {invoices && invoices.length > 0 ? (
          <div className="mt-4 pt-3 border-t space-y-2">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-2 text-xs bg-orange-50/50 rounded px-2 py-1.5"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {TRY_FORMATTER.format(Number(inv.amount))} {inv.currency}
                    {inv.invoice_no ? ` · ${inv.invoice_no}` : ""}
                  </div>
                  <div className="text-muted-foreground truncate">
                    {inv.description ?? "Açıklama yok"} ·{" "}
                    {inv.created_by_user.full_name ??
                      inv.created_by_user.email}{" "}
                    ·{" "}
                    {formatDistanceToNow(inv.created_at, {
                      addSuffix: true,
                      locale: tr,
                    })}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                  onClick={() => {
                    if (confirm("Bu el faturasını silmek istediğine emin misin?")) {
                      del.mutate({ id: inv.id });
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
