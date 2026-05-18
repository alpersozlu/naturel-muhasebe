"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { StoreCreateInput } from "@/lib/zod-schemas/store";

const formSchema = z.object({
  name: z.string().trim().min(2, "En az 2 karakter").max(80),
  city: z.string().trim().max(60),
  address: z.string().trim().max(200),
});
type FormValues = z.infer<typeof formSchema>;
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Mode =
  | { kind: "create"; brand_id: string }
  | {
      kind: "edit";
      brand_id: string;
      id: string;
      defaults: { name: string; city: string; address: string };
    };

export function StoreFormDialog({
  mode,
  trigger,
  open,
  onOpenChange,
}: {
  mode: Mode;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const utils = trpc.useUtils();
  const create = trpc.store.create.useMutation({
    onSuccess: () => {
      toast.success("Mağaza oluşturuldu");
      utils.store.listByBrand.invalidate({ brand_id: mode.brand_id });
      utils.brand.list.invalidate();
      utils.brand.get.invalidate({ id: mode.brand_id });
      setOpen(false);
      reset();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.store.update.useMutation({
    onSuccess: () => {
      toast.success("Mağaza güncellendi");
      utils.store.listByBrand.invalidate({ brand_id: mode.brand_id });
      utils.brand.get.invalidate({ id: mode.brand_id });
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const defaults =
    mode.kind === "edit"
      ? mode.defaults
      : { name: "", city: "", address: "" };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaults,
  });

  useEffect(() => {
    if (isOpen && mode.kind === "edit") reset(mode.defaults);
    if (isOpen && mode.kind === "create") reset({ name: "", city: "", address: "" });
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (values: FormValues) => {
    const payload: StoreCreateInput = {
      brand_id: mode.brand_id,
      name: values.name,
      city: values.city || undefined,
      address: values.address || undefined,
    };
    if (mode.kind === "create") {
      await create.mutateAsync(payload);
    } else {
      await update.mutateAsync({ ...payload, id: mode.id });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode.kind === "create" ? "Yeni Mağaza" : "Mağazayı Düzenle"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="store-name">Mağaza Adı</Label>
            <Input id="store-name" placeholder="Örn: Lefkoşa" {...register("name")} />
            {errors.name ? (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-city">Şehir (opsiyonel)</Label>
            <Input id="store-city" placeholder="Örn: Lefkoşa" {...register("city")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-address">Adres (opsiyonel)</Label>
            <Input id="store-address" placeholder="Sokak, mahalle..." {...register("address")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {mode.kind === "create" ? "Oluştur" : "Kaydet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CreateStoreButton({ brandId }: { brandId: string }) {
  return (
    <StoreFormDialog
      mode={{ kind: "create", brand_id: brandId }}
      trigger={
        <Button>
          <Plus className="h-4 w-4 mr-1" />
          Yeni Mağaza
        </Button>
      }
    />
  );
}
