"use client";

import { toast } from "sonner";
import { Users, Shield, Store, Briefcase, User as UserIcon } from "lucide-react";
import type { UserRole } from "@prisma/client";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  store_manager: "Mağaza Müdürü",
  cashier: "Kasiyer",
  sales_rep: "Satış Temsilcisi",
};

const ROLE_ICON: Record<UserRole, typeof Shield> = {
  admin: Shield,
  store_manager: Store,
  cashier: UserIcon,
  sales_rep: Briefcase,
};

const ROLE_COLOR: Record<UserRole, string> = {
  admin: "bg-indigo-100 text-indigo-700",
  store_manager: "bg-emerald-100 text-emerald-700",
  cashier: "bg-amber-100 text-amber-700",
  sales_rep: "bg-teal-100 text-teal-700",
};

export function UserList() {
  const { data, isLoading } = trpc.user.list.useQuery();
  const utils = trpc.useUtils();
  const updateRole = trpc.user.updateRole.useMutation({
    onSuccess: () => {
      toast.success("Rol güncellendi");
      utils.user.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground text-sm">
          Yükleniyor...
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground animate-fade-in">
          <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">Henüz kullanıcı yok.</div>
          <div className="text-sm mt-1">
            "Yeni Kullanıcı" butonuyla ilk çalışanı ekle.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y">
          {data.map((user) => {
            const Icon = ROLE_ICON[user.role];
            return (
              <div
                key={user.id}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${ROLE_COLOR[user.role]}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {user.full_name ?? user.email}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {user.email}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <Badge variant="outline" className="hidden sm:inline-flex">
                    {user._count.store_access} mağaza
                  </Badge>
                  <Select
                    value={user.role}
                    onValueChange={(v) =>
                      updateRole.mutate({
                        id: user.id,
                        role: v as UserRole,
                      })
                    }
                  >
                    <SelectTrigger className="w-44">
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
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
