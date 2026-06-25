"use client";

import { useState } from "react";
import { toast } from "sonner";
import { UserPlus, Loader2 } from "lucide-react";
import type { UserRole } from "@prisma/client";
import { trpc } from "@/lib/trpc";
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

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Yönetici",
  store_manager: "Mağaza Müdürü",
  cashier: "Kasiyer",
  sales_rep: "Satış Temsilcisi",
};

const NO_STORE = "__ALL__";

export function UserCreateForm() {
  const utils = trpc.useUtils();
  const { data: stores } = trpc.store.listAll.useQuery();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("store_manager");
  const [storeId, setStoreId] = useState<string>(NO_STORE);

  const create = trpc.user.create.useMutation({
    onSuccess: () => {
      toast.success("Kullanıcı oluşturuldu");
      utils.user.list.invalidate();
      setFullName("");
      setEmail("");
      setPassword("");
      setRole("store_manager");
      setStoreId(NO_STORE);
    },
    onError: (e) => toast.error(e.message),
  });

  const storeAssignable = role !== "admin" && role !== "sales_rep";
  const canSubmit = email.trim().length > 3 && password.length >= 8;

  const submit = () => {
    create.mutate({
      email: email.trim(),
      password,
      full_name: fullName.trim() || undefined,
      role,
      store_id: storeAssignable && storeId !== NO_STORE ? storeId : undefined,
    });
  };

  return (
    <Card>
      <CardContent className="p-5">
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Ad Soyad">
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Örneğin Ahmet Yılmaz"
              />
            </Field>
            <Field label="E-posta">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@derimod.com"
              />
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Şifre">
              <Input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Başlangıç şifresini belirle (en az 8)"
              />
            </Field>
            <Field label="Rol">
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Mağaza (sadece müdür/kasiyer için)">
            <Select
              value={storeId}
              onValueChange={setStoreId}
              disabled={!storeAssignable}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_STORE}>
                  — Tüm mağazalar (yönetim / bölgesel) —
                </SelectItem>
                {(stores ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Button
            className="w-full"
            disabled={!canSubmit || create.isPending}
            onClick={submit}
          >
            {create.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4 mr-1.5" />
            )}
            Kullanıcı Oluştur
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
