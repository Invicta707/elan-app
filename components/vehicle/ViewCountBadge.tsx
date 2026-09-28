"use client";

import { Eye } from "lucide-react";
import { formatViewCount, useViewCount, viewCountLabel } from "../../lib/vehicle-views";

// İzlenme rozeti: yarı saydam koyu hap, küçük göz simgesi ve kısa sayı
// ("450", "1,2B", "1,1M"). Masaüstü vitrin kartı, mobil akışın bilgi şeridi ve
// Shorts oynatıcısı aynı rozeti kullanır. Sayı bu oturumda sayılınca
// (lib/vehicle-views.ts) her yerde hemen güncellenir.
export default function ViewCountBadge({
  vehicleId,
  count,
  className = "",
}: {
  vehicleId: string;
  /** Listeden gelen sayı (vehicles.views_count) */
  count: number;
  className?: string;
}) {
  const views = useViewCount(vehicleId, count);
  return (
    <span
      data-view-count={views}
      className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-black/55 px-1.5 text-[11.5px] font-medium leading-none text-white ring-1 ring-inset ring-white/15 backdrop-blur-[6px] ${className}`}
    >
      <Eye aria-hidden="true" className="h-[13px] w-[13px] shrink-0" strokeWidth={2.2} />
      <span aria-hidden="true" className="tabular-nums">
        {formatViewCount(views)}
      </span>
      <span className="sr-only">{viewCountLabel(views)}</span>
    </span>
  );
}
