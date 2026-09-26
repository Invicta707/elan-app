import { formatBadge } from "../../lib/messages";

// Okunmamış mesaj rozeti: 0'da görünmez, 99'un üstü "99+". Ekran okuyucu
// için sayı ayrıca yazılır (görsel rozet aria-hidden).
export default function UnreadBadge({ count, className = "" }: { count: number; className?: string }) {
  const label = formatBadge(count);
  if (!label) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#FF3040] px-1 text-[11px] font-bold leading-none text-white shadow-[0_0_0_2px_var(--badge-ring,#fff)] tabular-nums motion-safe:animate-[badge-pop_220ms_cubic-bezier(0.34,1.56,0.64,1)] ${className}`}
      >
        {label}
      </span>
      <span className="sr-only">, {count} okunmamış mesaj</span>
    </>
  );
}
