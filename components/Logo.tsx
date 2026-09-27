import EyePlayMark from "./brand/EyePlayMark";

// gözüyle logosu: ince göz hattı + oynat üçgeni (components/brand/EyePlayMark)
// ve yazı. Renk dışarıdan gelir (currentColor): video akışında beyaz, açık
// zeminli sayfalarda başlığın metin rengi. className'de renk verilmezse beyaz.
export default function Logo({
  className = "h-7 text-white",
  showText = true,
  iconClassName = "h-6 w-6",
}: {
  className?: string;
  /** Göz simgesinin boyutu */
  iconClassName?: string;
  /** false: sadece göz simgesi (üst çubuk). Erişilebilir ad kullanıldığı yerde verilir. */
  showText?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 select-none ${className}`}>
      <EyePlayMark className={iconClassName} />
      {showText && <span className="text-[19px] font-semibold tracking-[-0.01em] lowercase">gözüyle</span>}
    </div>
  );
}
