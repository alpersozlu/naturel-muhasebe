import { cn } from "@/lib/utils";

/**
 * Base skeleton block. Uses a subtle shimmer (tailwindcss-animate's
 * animate-pulse) at slate-200 → muted/40 transition for an Apple-like
 * "breathing" placeholder.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted/60",
        className
      )}
      {...props}
    />
  );
}

/** Vertical stack of skeleton rows (for list items). */
export function ListSkeleton({
  rows = 3,
  rowHeight = "h-14",
}: {
  rows?: number;
  rowHeight?: string;
}) {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn(rowHeight, "w-full")} />
      ))}
    </div>
  );
}

/** Card-shaped skeleton with avatar + 2 lines. */
export function CardSkeleton() {
  return (
    <div className="flex items-center gap-3 p-4">
      <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

/** Grid of stat-card-shaped skeletons. */
export function StatCardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border/70 bg-card p-5">
          <Skeleton className="h-10 w-10 rounded-xl mb-3" />
          <Skeleton className="h-7 w-24 mb-2" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Chart-shaped placeholder. */
export function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-5">
      <Skeleton className="h-4 w-32 mb-2" />
      <Skeleton className="h-3 w-48 mb-4" />
      <Skeleton className="w-full rounded-md" style={{ height }} />
    </div>
  );
}
