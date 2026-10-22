import { cn } from "@/lib/utils";

/** Baş harfli renkli kare — aynı isim hep aynı renk (listede göz kişiyi çabuk bulsun). */
const AVATAR = ["bg-rose-500", "bg-indigo-500", "bg-emerald-600", "bg-amber-500", "bg-sky-600", "bg-violet-500", "bg-teal-600"];
export function Avatar({ name, small }: { name: string; small?: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toLocaleUpperCase("tr-TR"))
    .join("");
  const color = AVATAR[Array.from(name).reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-xl font-semibold text-white", color, small ? "h-10 w-10 text-sm" : "h-12 w-12 text-base")}>
      {initials}
    </span>
  );
}

