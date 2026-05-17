"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Building2, Store, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandFormDialog } from "./brand-form-dialog";

export function BrandList() {
  const { data, isLoading } = trpc.brand.list.useQuery();
  const utils = trpc.useUtils();
  const softDelete = trpc.brand.softDelete.useMutation({
    onSuccess: () => {
      toast.success("Marka silindi (Çöp'ten geri alınabilir)");
      utils.brand.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const [editing, setEditing] = useState<{
    id: string;
    defaults: { name: string; logo_url: string };
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
          <Building2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">Henüz hiçbir marka yok.</div>
          <div className="text-sm mt-1">
            İşe başlamak için sağ üstteki "Yeni Marka" butonunu kullanın.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.map((brand) => (
          <Card key={brand.id}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Building2 className="h-5 w-5" />
                </div>
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
                          id: brand.id,
                          defaults: {
                            name: brand.name,
                            logo_url: brand.logo_url ?? "",
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
                          confirm(`"${brand.name}" markasını silmek istediğine emin misin?`)
                        ) {
                          softDelete.mutate({ id: brand.id });
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Sil
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="font-semibold leading-tight">{brand.name}</div>
              <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                <Store className="h-3.5 w-3.5" />
                {brand._count.stores} mağaza
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {editing ? (
        <BrandFormDialog
          mode={{ kind: "edit", id: editing.id, defaults: editing.defaults }}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      ) : null}
    </>
  );
}
