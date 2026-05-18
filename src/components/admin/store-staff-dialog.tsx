"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Users, Trash2, UserPlus } from "lucide-react";
import type { UserRole } from "@prisma/client";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Badge } from "@/components/ui/badge";

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  store_manager: "Mağaza Müdürü",
  cashier: "Kasiyer",
  sales_rep: "Satış Temsilcisi",
};

const ASSIGNABLE_ROLES: UserRole[] = ["store_manager", "cashier", "sales_rep"];

export function StoreStaffDialog({
  storeId,
  storeName,
  open,
  onOpenChange,
  defaultRole = "cashier",
}: {
  storeId: string;
  storeName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultRole?: UserRole;
}) {
  const utils = trpc.useUtils();
  const { data: access } = trpc.userStoreAccess.listForStore.useQuery(
    { store_id: storeId },
    { enabled: open }
  );
  const { data: allUsers } = trpc.user.list.useQuery(undefined, { enabled: open });

  const [pickedUserId, setPickedUserId] = useState<string>("");
  const [pickedRole, setPickedRole] = useState<UserRole>(defaultRole);

  const assign = trpc.userStoreAccess.assign.useMutation({
    onSuccess: () => {
      toast.success("Atandı");
      utils.userStoreAccess.listForStore.invalidate({ store_id: storeId });
      utils.user.list.invalidate();
      setPickedUserId("");
    },
    onError: (e) => toast.error(e.message),
  });

  const unassign = trpc.userStoreAccess.unassign.useMutation({
    onSuccess: () => {
      toast.success("Çıkarıldı");
      utils.userStoreAccess.listForStore.invalidate({ store_id: storeId });
      utils.user.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // Zaten atanmış olanları "Yeni ata" select'inden çıkar
  const assignedIds = new Set((access ?? []).map((a) => a.user_id));
  const availableUsers = (allUsers ?? []).filter(
    (u) => !assignedIds.has(u.id) && u.role !== "admin"
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-emerald-600" />
            {storeName} — Çalışanlar
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Atanmış liste */}
          <div>
            <div className="text-sm font-medium mb-2">Atanmış</div>
            {access && access.length > 0 ? (
              <div className="border rounded-lg divide-y">
                {access.map((a) => (
                  <div
                    key={a.user_id}
                    className="flex items-center justify-between px-3 py-2.5 gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate text-sm">
                        {a.user.full_name ?? a.user.email}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {a.user.email}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-xs">
                        {ROLE_LABEL[a.role]}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() =>
                          unassign.mutate({ user_id: a.user_id, store_id: storeId })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground border rounded-lg px-3 py-4 text-center">
                Henüz atanmış kimse yok.
              </div>
            )}
          </div>

          {/* Yeni ata */}
          <div className="space-y-2 pt-2 border-t">
            <div className="text-sm font-medium">Yeni Ata</div>
            {availableUsers.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                Atanabilir kullanıcı yok. Önce
                <a href="/tr/admin/users" className="underline ml-1">
                  kullanıcı oluştur
                </a>
                .
              </div>
            ) : (
              <div className="flex gap-2 items-start">
                <Select value={pickedUserId} onValueChange={setPickedUserId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Kullanıcı seç" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.full_name ?? u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={pickedRole}
                  onValueChange={(v) => setPickedRole(v as UserRole)}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={!pickedUserId}
                  onClick={() =>
                    assign.mutate({
                      user_id: pickedUserId,
                      store_id: storeId,
                      role: pickedRole,
                    })
                  }
                >
                  <UserPlus className="h-4 w-4 mr-1" />
                  Ata
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
