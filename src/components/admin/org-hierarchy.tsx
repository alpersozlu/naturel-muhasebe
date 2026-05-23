"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  Store,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Users,
  Briefcase,
  MapPin,
  CalendarDays,
} from "lucide-react";
import type { UserRole } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BrandFormDialog } from "./brand-form-dialog";
import { StoreFormDialog } from "./store-form-dialog";
import { BrandLogo } from "@/components/brand/brand-logo";
import { StoreStaffDialog } from "./store-staff-dialog";
import { ListSkeleton } from "@/components/shared/skeleton";

export function OrgHierarchy() {
  const { data, isLoading } = trpc.brand.list.useQuery();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-0">
          <ListSkeleton rows={3} rowHeight="h-16" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground animate-fade-in">
          <Building2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">Henüz hiçbir marka yok.</div>
          <div className="text-sm mt-1">
            Yukarıdaki "Yeni Marka" butonuyla başla.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0 divide-y">
        {data.map((brand) => (
          <BrandRow
            key={brand.id}
            id={brand.id}
            name={brand.name}
            logoUrl={brand.logo_url}
            storeCount={brand._count.stores}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function BrandRow({
  id,
  name,
  logoUrl,
  storeCount,
}: {
  id: string;
  name: string;
  logoUrl: string | null;
  storeCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [creatingStore, setCreatingStore] = useState(false);
  const utils = trpc.useUtils();

  const { data: stores } = trpc.store.listByBrand.useQuery(
    { brand_id: id },
    { enabled: open }
  );

  const softDelete = trpc.brand.softDelete.useMutation({
    onSuccess: () => {
      toast.success("Marka silindi");
      utils.brand.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <div>
        <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/30">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 h-7 w-7 rounded hover:bg-muted flex items-center justify-center"
          >
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>

          <BrandLogo name={name} logoUrl={logoUrl} size="sm" className="shrink-0" />

          <div
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => setOpen((o) => !o)}
          >
            <div className="font-semibold leading-tight truncate">{name}</div>
            <div className="text-xs text-muted-foreground">
              ({storeCount} mağaza)
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="text-emerald-700 hover:text-emerald-700 hover:bg-emerald-50"
            onClick={() => setCreatingStore(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Mağaza Ekle
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setEditing(true)}
            title="Düzenle"
          >
            <Plus className="h-4 w-4 rotate-45 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => {
              if (confirm(`"${name}" markasını silmek istediğine emin misin?`)) {
                softDelete.mutate({ id });
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {open && stores ? (
          <div className="bg-muted/20 border-t">
            {stores.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Bu markada henüz mağaza yok.
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {stores.map((s) => (
                  <StoreRow
                    key={s.id}
                    storeId={s.id}
                    name={s.name}
                    city={s.city}
                    brandId={id}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {editing ? (
        <BrandFormDialog
          mode={{
            kind: "edit",
            id,
            defaults: { name, logo_url: logoUrl ?? "" },
          }}
          open
          onOpenChange={(o) => !o && setEditing(false)}
        />
      ) : null}

      {creatingStore ? (
        <StoreFormDialog
          mode={{ kind: "create", brand_id: id }}
          open
          onOpenChange={(o) => !o && setCreatingStore(false)}
        />
      ) : null}
    </>
  );
}

function StoreRow({
  storeId,
  name,
  city,
  brandId,
}: {
  storeId: string;
  name: string;
  city: string | null;
  brandId: string;
}) {
  const [staffOpen, setStaffOpen] = useState(false);
  const [staffRole, setStaffRole] = useState<UserRole>("store_manager");
  const utils = trpc.useUtils();

  const { data: access } = trpc.userStoreAccess.listForStore.useQuery({
    store_id: storeId,
  });

  const softDelete = trpc.store.softDelete.useMutation({
    onSuccess: () => {
      toast.success("Mağaza silindi");
      utils.store.listByBrand.invalidate({ brand_id: brandId });
      utils.brand.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const managerCount =
    access?.filter(
      (a) => a.role === "store_manager" || a.role === "cashier"
    ).length ?? 0;

  return (
    <>
      <div className="flex items-center gap-3 pl-12 pr-5 py-3 hover:bg-muted/40 group">
        <Link
          href={`/stores/${storeId}`}
          className="flex items-center gap-3 flex-1 min-w-0"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 shrink-0 group-hover:scale-105 transition-transform">
            <Store className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-tight truncate group-hover:text-primary transition-colors">
              {name}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              {city ? (
                <>
                  <MapPin className="h-3 w-3" /> {city} ·{" "}
                </>
              ) : null}
              ( {managerCount} mağaza müdürü )
            </div>
          </div>
        </Link>

        <Button
          variant="ghost"
          size="sm"
          className="text-primary hover:text-primary hover:bg-primary/10"
          asChild
        >
          <Link href={`/stores/${storeId}`}>
            <CalendarDays className="h-3.5 w-3.5 mr-1" />
            Takvim
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-amber-700 hover:text-amber-700 hover:bg-amber-50"
          onClick={() => {
            setStaffRole("store_manager");
            setStaffOpen(true);
          }}
        >
          <Users className="h-3.5 w-3.5 mr-1" />
          Mağaza Yöneticisi Ekle
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-teal-700 hover:text-teal-700 hover:bg-teal-50"
          onClick={() => {
            setStaffRole("sales_rep");
            setStaffOpen(true);
          }}
        >
          <Briefcase className="h-3.5 w-3.5 mr-1" />
          Satış Temsilcisi Ekle
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={() => {
            if (confirm(`"${name}" mağazasını silmek istediğine emin misin?`)) {
              softDelete.mutate({ id: storeId });
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {staffOpen ? (
        <StoreStaffDialog
          storeId={storeId}
          storeName={name}
          defaultRole={staffRole}
          open
          onOpenChange={setStaffOpen}
        />
      ) : null}
    </>
  );
}
