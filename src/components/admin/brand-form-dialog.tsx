"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { brandCreateSchema, type BrandCreateInput } from "@/lib/zod-schemas/brand";
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
import { Plus } from "lucide-react";

type Mode = { kind: "create" } | { kind: "edit"; id: string; defaults: BrandCreateInput };

export function BrandFormDialog({
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
  const create = trpc.brand.create.useMutation({
    onSuccess: () => {
      toast.success("Marka oluşturuldu");
      utils.brand.list.invalidate();
      setOpen(false);
      reset();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.brand.update.useMutation({
    onSuccess: () => {
      toast.success("Marka güncellendi");
      utils.brand.list.invalidate();
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BrandCreateInput>({
    resolver: zodResolver(brandCreateSchema),
    defaultValues: mode.kind === "edit" ? mode.defaults : { name: "", logo_url: "" },
  });

  const onSubmit = async (values: BrandCreateInput) => {
    if (mode.kind === "create") {
      await create.mutateAsync(values);
    } else {
      await update.mutateAsync({ ...values, id: mode.id });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode.kind === "create" ? "Yeni Marka" : "Markayı Düzenle"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Marka Adı</Label>
            <Input id="name" placeholder="Örn: Mavi Jeans" {...register("name")} />
            {errors.name ? (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="logo_url">Logo URL (opsiyonel)</Label>
            <Input id="logo_url" placeholder="https://..." {...register("logo_url")} />
            {errors.logo_url ? (
              <p className="text-sm text-destructive">{errors.logo_url.message}</p>
            ) : null}
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

export function CreateBrandButton() {
  return (
    <BrandFormDialog
      mode={{ kind: "create" }}
      trigger={
        <Button>
          <Plus className="h-4 w-4 mr-1" />
          Yeni Marka
        </Button>
      }
    />
  );
}
