"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Users,
  Shield,
  Store,
  Briefcase,
  User as UserIcon,
  Trash2,
  Loader2,
} from "lucide-react";
import type { UserRole } from "@prisma/client";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const { data: me } = trpc.user.me.useQuery();
  const utils = trpc.useUtils();
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const updateRole = trpc.user.updateRole.useMutation({
    onSuccess: () => {
      toast.success("Rol güncellendi");
      utils.user.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteUser = trpc.user.delete.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.mode === "soft"
          ? "Kullanıcı kaldırıldı — geçmiş kayıtları korundu"
          : "Kullanıcı silindi"
      );
      setPendingDelete(null);
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
    <>
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {data.map((user) => {
              const Icon = ROLE_ICON[user.role];
              const storeNames = user.store_access.map((a) => a.store.name);
              const isSelf = me?.id === user.id;
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
                    {/* Atanan mağazalar — admin tüm mağazaları görür */}
                    <div className="hidden sm:flex items-center gap-1.5 flex-wrap justify-end max-w-xs">
                      {user.role === "admin" ? (
                        <span className="text-xs text-muted-foreground">
                          Tüm mağazalar
                        </span>
                      ) : storeNames.length === 0 ? (
                        <span className="text-xs text-amber-600 font-medium">
                          Mağaza atanmadı
                        </span>
                      ) : (
                        <>
                          {storeNames.slice(0, 2).map((s) => (
                            <Badge
                              key={s}
                              variant="outline"
                              className="font-normal gap-1"
                            >
                              <Store className="h-3 w-3 text-muted-foreground" />
                              {s}
                            </Badge>
                          ))}
                          {storeNames.length > 2 ? (
                            <Badge
                              variant="outline"
                              className="font-normal"
                              title={storeNames.join(", ")}
                            >
                              +{storeNames.length - 2}
                            </Badge>
                          ) : null}
                        </>
                      )}
                    </div>

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

                    {!isSelf ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-rose-50"
                        title="Kullanıcıyı kaldır"
                        onClick={() =>
                          setPendingDelete({
                            id: user.id,
                            name: user.full_name ?? user.email,
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : (
                      <div className="h-9 w-9" aria-hidden />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Silme onayı */}
      <Dialog
        open={!!pendingDelete}
        onOpenChange={(o) => {
          if (!o && !deleteUser.isPending) setPendingDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kullanıcıyı kaldır</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">
                {pendingDelete?.name}
              </span>{" "}
              sistemden kaldırılacak: giriş yapamaz ve mağaza erişimleri
              silinir. Yaptığı yüklemeler ve geçmiş kayıtları korunur. Bu işlem
              geri alınamaz.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              disabled={deleteUser.isPending}
              onClick={() => setPendingDelete(null)}
            >
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              disabled={deleteUser.isPending}
              onClick={() =>
                pendingDelete && deleteUser.mutate({ id: pendingDelete.id })
              }
            >
              {deleteUser.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Kaldırılıyor
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Kaldır
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
