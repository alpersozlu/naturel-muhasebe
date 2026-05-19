"use client";

import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useCountUp } from "@/lib/use-count-up";

const TRY_FORMATTER = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMoney(n: number): string {
  return TRY_FORMATTER.format(n);
}

export function StatCard({
  icon: Icon,
  label,
  value,
  suffix = "₺",
  color = "text-indigo-600",
  bgColor = "bg-indigo-50",
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  suffix?: string;
  color?: string;
  bgColor?: string;
  hint?: string;
}) {
  const animated = useCountUp(value, 700);
  return (
    <Card className="hover:shadow-sm animate-slide-up">
      <CardContent className="p-5">
        <div
          className={`h-10 w-10 rounded-xl flex items-center justify-center ${bgColor} ${color} mb-3 transition-transform duration-soft ease-snappy`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="text-2xl font-bold tabular-nums tracking-tight">
          {fmtMoney(animated)}
          <span className="text-base font-normal text-muted-foreground ml-1">
            {suffix}
          </span>
        </div>
        <div className="text-sm text-muted-foreground mt-1">{label}</div>
        {hint ? (
          <div className="text-xs text-muted-foreground mt-1.5">{hint}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
