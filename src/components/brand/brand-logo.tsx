import { Building2 } from "lucide-react";

/**
 * Marka adına göre dispatch:
 * - Tanınan markalar (Derimod, Mavi...) → resmi logo (public/brands/).
 * - logoUrl varsa → o görsel (img tag).
 * - Aksi halde → kare içinde generic Building2 ikonu (eski davranış).
 *
 * `size` prop:
 *   "md" — kart listesi (sidebar, brand-list cards)
 *   "sm" — satır içi (org-hierarchy)
 */
export function BrandLogo({
  name,
  logoUrl,
  size = "md",
  className = "",
}: {
  name: string;
  logoUrl?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const builtIn = renderBuiltIn(name, size);
  const containerH = size === "sm" ? "h-9" : "h-11";
  const containerW = size === "sm" ? "w-9" : "w-11";
  const containerR = size === "sm" ? "rounded-lg" : "rounded-xl";

  if (builtIn) {
    // Yerleşik wordmark — beyaz arka plan + ince çerçeve, yatay alan
    return (
      <div
        className={`flex ${containerH} items-center justify-center rounded-lg bg-white border border-slate-200 px-2 ${className}`}
      >
        {builtIn}
      </div>
    );
  }

  if (logoUrl) {
    // Kullanıcı URL koymuşsa
    return (
      <div
        className={`flex ${containerH} ${containerW} items-center justify-center ${containerR} bg-white border border-slate-200 overflow-hidden ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={`${name} logosu`}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }

  // Generic fallback
  return (
    <div
      className={`flex ${containerH} ${containerW} items-center justify-center ${containerR} bg-primary/10 text-primary ${className}`}
    >
      <Building2 className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
    </div>
  );
}

function renderBuiltIn(name: string, size: "sm" | "md") {
  // Türkçe lowercase + I/ı/İ/i normalize:
  // "DERIMOD" → toLocaleLowerCase("tr") → "derımod" (ASCII I → ı), bu yüzden ı↔i birleştirilir.
  const norm = name
    .trim()
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i");
  const logoClass = size === "sm" ? "h-5 w-auto" : "h-7 w-auto";

  // "Derimod", "DERİMOD", "DERIMOD", "Derimod KKTC" vb. hepsi eşleşir
  if (norm.includes("derimod")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/brands/derimod.png"
        alt="Derimod logosu"
        className={`${logoClass} object-contain`}
      />
    );
  }
  if (norm.includes("mavi")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/brands/mavi.svg"
        alt="Mavi logosu"
        className={`${logoClass} object-contain`}
      />
    );
  }
  return null;
}
