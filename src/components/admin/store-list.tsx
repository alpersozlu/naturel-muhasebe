"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Store, MoreVertical, Pencil, Trash2, MapPin } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StoreFormDialog } from "./store-form-dialog";

export function StoreList({ brandId }: { brandId: string }) {
  const { data, isLoading } = trpc.store.listByBrand.useQuery({ brand_id: brandId });
  const utils = trpc.useUtils();
  const softDelete = trpc.store.softDelete.useMutation({
    onSuccess: () => {
      toast.success("Mağaza silindi");
      utils.store.listByBrand.invalidate({ brand_id: brandId });
      utils.brand.get.invalidate({ id: brandId });
      utils.brand.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const [editing, setEditing] = useState<{
    id: string;
    defaults: { name: string; city: string; address: string };
  } | null>(null);

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
          <Store className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">Henüz mağaza yok.</div>
          <div className="text-sm mt-1">
            Yukarıdaki "Yeni Mağaza" butonuyla ilk mağazayı ekle.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.map((store) => (
          <Card key={store.id} className="relative">
            <div className="absolute top-3 right-3 z-10">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() =>
                      setEditing({
                        id: store.id,
                        defaults: {
                          name: store.name,
                          city: store.city ?? "",
                          address: store.address ?? "",
                        },
                      })
                    }
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Düzenle
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() => {
                      if (
                        confirm(`"${store.name}" mağazasını silmek istediğine emin misin?`)
                      ) {
                        softDelete.mutate({ id: store.id });
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Sil
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <CardContent className="p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 mb-3">
                <Store className="h-5 w-5" />
              </div>
              <div className="font-semibold leading-tight">{store.name}</div>
              {store.city ? (
                <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {store.city}
                </div>
              ) : null}
              {store.address ? (
                <div className="text-xs text-muted-foreground mt-2 line-clamp-2">
                  {store.address}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      {editing ? (
        <StoreFormDialog
          mode={{
            kind: "edit",
            brand_id: brandId,
            id: editing.id,
            defaults: editing.defaults,
          }}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      ) : null}
    </>
  );
}
