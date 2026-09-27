import { EYE_PATH, EYE_STROKE, PLAY_POINTS, PLAY_ROUNDING } from "../../lib/brand-mark";

// gözüyle işareti (SVG, currentColor): her boyutta keskin, tek renk.
export default function EyePlayMark({
  className = "h-6 w-6",
  strokeWidth = EYE_STROKE,
  title,
}: {
  className?: string;
  /** 100 birimlik tuvalde göz hattının kalınlığı */
  strokeWidth?: number;
  /** Verilirse erişilebilir ad; verilmezse süs (aria-hidden) */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={`shrink-0 ${className}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d={EYE_PATH} stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
      <polygon
        points={PLAY_POINTS}
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={PLAY_ROUNDING}
        strokeLinejoin="round"
      />
    </svg>
  );
}
