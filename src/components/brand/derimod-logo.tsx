/**
 * Derimod marka wordmark'ı — geniş kalın siyah "DERİMOD" yazısı.
 * Görseldeki orijinale yakın: Impact / Arial Black benzeri condensed bold.
 */
export function DerimodLogo({ className = "h-7 w-auto" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 40"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-label="Derimod logosu"
      role="img"
    >
      <text
        x="100"
        y="22"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Impact, 'Arial Narrow', 'Arial Black', 'Helvetica Neue', sans-serif"
        fontWeight="900"
        fontSize="34"
        letterSpacing="-0.5"
        fill="currentColor"
      >
        DERİMOD
      </text>
    </svg>
  );
}
