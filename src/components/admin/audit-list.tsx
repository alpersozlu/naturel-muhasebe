"use client";

import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { Activity } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const ACTION_LABEL: Record<string, string> = {
  create: "Oluşturdu",
  update: "Güncelledi",
  delete: "Sildi",
  restore: "Geri aldı",
  assign: "Atadı",
  unassign: "Çıkardı",
  approve: "Onayladı",
  lock: "Kilitledi",
  unlock: "Kilidi açtı",
};

const ACTION_COLOR: Record<string, string> = {
  create: "bg-emerald-100 text-emerald-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-rose-100 text-rose-700",
  restore: "bg-amber-100 text-amber-700",
  assign: "bg-indigo-100 text-indigo-700",
  unassign: "bg-slate-100 text-slate-700",
  approve: "bg-emerald-100 text-emerald-700",
  lock: "bg-slate-100 text-slate-700",
  unlock: "bg-amber-100 text-amber-700",
};

export function AuditList() {
  const { data, isLoading } = trpc.audit.list.useQuery({ limit: 100 });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-0 divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-5 py-3 flex items-center gap-4">
              <div className="h-5 w-20 rounded animate-pulse bg-muted/60" />
              <div className="flex-1">
                <div className="h-3 w-2/3 rounded animate-pulse bg-muted/60" />
              </div>
              <div className="h-3 w-24 rounded animate-pulse bg-muted/50" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">Henüz aktivite yok.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y">
          {data.map((log) => (
            <div key={log.id} className="px-5 py-3 flex items-center gap-4">
              <Badge
                variant="secondary"
                className={`${ACTION_COLOR[log.action] ?? "bg-slate-100 text-slate-700"} shrink-0`}
              >
                {ACTION_LABEL[log.action] ?? log.action}
              </Badge>
              <div className="flex-1 min-w-0">
                <div className="text-sm">
                  <span className="font-medium">
                    {log.user?.full_name ?? log.user?.email ?? "Bilinmeyen"}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {log.entity_type}
                    {log.entity_id ? (
                      <code className="ml-1 text-xs">
                        ({log.entity_id.slice(0, 8)}…)
                      </code>
                    ) : null}
                  </span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground shrink-0">
                {formatDistanceToNow(log.created_at, { addSuffix: true, locale: tr })}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
