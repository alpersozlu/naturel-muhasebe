"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Users,
  Shield,
  Store,
  Briefcase,
  User as UserIcon,
  Pencil,
  KeyRound,
  Ban,
  Power,
  Trash2,
  Loader2,
} from "lucide-react";
import type { UserRole } from "@prisma/client";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Yönetici",
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

const ROLE_BADGE: Record<UserRole, string> = {
  admin: "bg-indigo-100 text-indigo-700",
  store_manager: "bg-emerald-100 text-emerald-700",
  cashier: "bg-amber-100 text-amber-700",
  sales_rep: "bg-teal-100 text-teal-700",
};

type Row = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  store_access: Array<{ store: { id: string; name: string } }>;
};

export function UserList() {
  const { data, isLoading } = trpc.user.list.useQuery();
  const { data: me } = trpc.user.me.useQuery();
  const utils = trpc.useUtils();

  const [editUser, setEditUser] = useState<Row | null>(null);
  const [pwUser, setPwUser] = useState<Row | null>(null);
  const [delUser, setDelUser] = useState<Row | null>(null);

  const setActive = trpc.user.setActive.useMutation({
    onSuccess: (u) => {
      toast.success(u.is_active ? "Kullanıcı aktifleştirildi" : "Kullanıcı devre dışı bırakıldı");
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
      setDelUser(null);
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
        <CardContent className="py-16 text-center text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">Henüz kullanıcı yok.</div>
          <div className="text-sm mt-1">Aşağıdan ilk çalışanı ekle.</div>
        </CardContent>
      </Card>
    );
  }

  const rows = data as Row[];

  return (
    <>
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left font-semibold px-4 py-3">İsim</th>
                  <th className="text-left font-semibold px-4 py-3">E-posta</th>
                  <th className="text-left font-semibold px-4 py-3">Rol</th>
                  <th className="text-left font-semibold px-4 py-3">Mağaza</th>
                  <th className="text-left font-semibold px-4 py-3">Durum</th>
                  <th className="text-left font-semibold px-4 py-3">Eylemler</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const Icon = ROLE_ICON[u.role];
                  const isSelf = me?.id === u.id;
                  const stores = u.store_access.map((a) => a.store.name);
                  return (
                    <tr key={u.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${ROLE_BADGE[u.role]}`}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <span className="font-medium">{u.full_name ?? "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block text-xs font-medium px-2 py-0.5 rounded-md ${ROLE_BADGE[u.role]}`}
                        >
                          {ROLE_LABEL[u.role]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {u.role === "admin" || u.role === "sales_rep" ? (
                          <span className="text-muted-foreground">Tüm mağazalar</span>
                        ) : stores.length === 0 ? (
                          <span className="text-amber-600 font-medium text-xs">
                            Mağaza atanmadı
                          </span>
                        ) : (
                          <span className="truncate">{stores.join(", ")}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {u.is_active ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Aktif
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                            Pasif
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                            onClick={() => setEditUser(u)}
                          >
                            <Pencil className="h-3.5 w-3.5" /> Düzenle
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 text-amber-700 border-amber-200 hover:bg-amber-50"
                            onClick={() => setPwUser(u)}
                          >
                            <KeyRound className="h-3.5 w-3.5" /> Şifre
                          </Button>
                          {!isSelf ? (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1"
                                disabled={setActive.isPending}
                                onClick={() =>
                                  setActive.mutate({ id: u.id, is_active: !u.is_active })
                                }
                              >
                                {u.is_active ? (
                                  <>
                                    <Ban className="h-3.5 w-3.5" /> Devre dışı bırak
                                  </>
                                ) : (
                                  <>
                                    <Power className="h-3.5 w-3.5 text-emerald-600" /> Aktifleştir
                                  </>
                                )}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1 text-rose-600 border-rose-200 hover:bg-rose-50"
                                onClick={() => setDelUser(u)}
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Sil
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {editUser ? (
        <EditDialog user={editUser} onClose={() => setEditUser(null)} />
      ) : null}
      {pwUser ? (
        <PasswordDialog user={pwUser} onClose={() => setPwUser(null)} />
      ) : null}

      {/* Silme onayı */}
      <Dialog open={!!delUser} onOpenChange={(o) => !o && !deleteUser.isPending && setDelUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kullanıcıyı sil</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">
                {delUser?.full_name ?? delUser?.email}
              </span>{" "}
              sistemden silinecek: giriş yapamaz, mağaza erişimleri kaldırılır. Yüklemeleri ve
              geçmiş kayıtları korunur. Bu işlem geri alınamaz.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={deleteUser.isPending} onClick={() => setDelUser(null)}>
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              disabled={deleteUser.isPending}
              onClick={() => delUser && deleteUser.mutate({ id: delUser.id })}
            >
              {deleteUser.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Siliniyor
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-1.5" /> Sil
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditDialog({ user, onClose }: { user: Row; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [role, setRole] = useState<UserRole>(user.role);
  const update = trpc.user.updateRole.useMutation({
    onSuccess: () => {
      toast.success("Kullanıcı güncellendi");
      utils.user.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !update.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Kullanıcıyı düzenle</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Ad Soyad</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Rol</Label>
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
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={update.isPending} onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            disabled={update.isPending}
            onClick={() => update.mutate({ id: user.id, role, full_name: fullName || undefined })}
          >
            {update.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ user, onClose }: { user: Row; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const setPassword = trpc.user.setPassword.useMutation({
    onSuccess: () => {
      toast.success("Şifre güncellendi");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const tooShort = pw.length > 0 && pw.length < 8;
  return (
    <Dialog open onOpenChange={(o) => !o && !setPassword.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Şifre değiştir</DialogTitle>
          <DialogDescription>
            {user.full_name ?? user.email} için yeni şifre belirle.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-1">
          <Label>Yeni Şifre</Label>
          <Input
            type="text"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="En az 8 karakter"
            autoFocus
          />
          {tooShort ? <p className="text-xs text-rose-600">En az 8 karakter olmalı</p> : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={setPassword.isPending} onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            disabled={setPassword.isPending || pw.length < 8}
            onClick={() => setPassword.mutate({ id: user.id, password: pw })}
          >
            {setPassword.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            Şifreyi Güncelle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
