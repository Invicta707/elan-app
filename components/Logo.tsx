// gözüyle logosu: göz + oynat simgesi ve yazı. Renk dışarıdan gelir
// (currentColor): video akışında beyaz, açık zeminli sayfalarda başlığın metin
// rengi. className'de renk verilmezse varsayılan beyaz.
export default function Logo({
  className = "h-7 text-white",
  showText = true,
}: {
  className?: string;
  /** false: sadece göz simgesi (üst çubuk). Erişilebilir ad kullanıldığı yerde verilir. */
  showText?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2.5 font-bold tracking-tight select-none ${className}`}>
      <svg
        viewBox="0 0 100 100"
        className="h-6 w-6 flex-shrink-0"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M 12 50 C 26 28, 74 28, 88 50 C 74 72, 26 72, 12 50 Z"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinejoin="round"
        />
        <polygon points="45,39 65,50 45,61" fill="currentColor" />
      </svg>
      {showText && <span className="text-xl font-bold tracking-tight lowercase">gözüyle</span>}
    </div>
  );
}
