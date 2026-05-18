"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { userRoleEnum } from "@/lib/zod-schemas/user";

const formSchema = z.object({
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta gir"),
  password: z.string().min(8, "En az 8 karakter"),
  full_name: z.string().trim().max(80),
  role: userRoleEnum,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function UserCreateDialog() {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const create = trpc.user.create.useMutation({
    onSuccess: () => {
      toast.success("Kullanıcı oluşturuldu");
      utils.user.list.invalidate();
      setOpen(false);
      reset();
    },
    onError: (e) => toast.error(e.message),
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", password: "", full_name: "", role: "cashier" },
  });

  const roleValue = watch("role");

  const onSubmit = (values: FormValues) =>
    create.mutateAsync({
      email: values.email,
      password: values.password,
      full_name: values.full_name || undefined,
      role: values.role,
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="h-4 w-4 mr-1" />
          Yeni Kullanıcı
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yeni Kullanıcı Oluştur</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-posta</Label>
            <Input
              id="email"
              type="email"
              placeholder="ornek@firma.com"
              autoComplete="off"
              {...register("email")}
            />
            {errors.email ? (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Şifre</Label>
            <Input
              id="password"
              type="password"
              placeholder="En az 8 karakter"
              autoComplete="new-password"
              {...register("password")}
            />
            {errors.password ? (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="full_name">Ad Soyad (opsiyonel)</Label>
            <Input id="full_name" placeholder="Ahmet Yılmaz" {...register("full_name")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">Rol</Label>
            <Select
              value={roleValue}
              onValueChange={(v) =>
                setValue("role", v as FormValues["role"], { shouldDirty: true })
              }
            >
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="store_manager">Mağaza Müdürü</SelectItem>
                <SelectItem value="cashier">Kasiyer</SelectItem>
                <SelectItem value="sales_rep">Satış Temsilcisi</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Oluştur
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
