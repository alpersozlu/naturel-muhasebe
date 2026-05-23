/**
 * Naturel Ticaret Muhasebe — marka logosu.
 * Daire içinde serif bold "NR" — color currentColor (parent text rengini izler).
 *
 * Kullanım:
 *   <NrLogo className="h-10 w-10" />
 *   <NrLogo className="h-12 w-12 text-violet-600" />
 */
export function NrLogo({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Naturel Ticaret logosu"
      role="img"
    >
      {/* Outer ring */}
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      {/* NR */}
      <text
        x="50"
        y="52"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontWeight="700"
        fontSize="48"
        letterSpacing="-2"
        fill="currentColor"
      >
        NR
      </text>
    </svg>
  );
}
