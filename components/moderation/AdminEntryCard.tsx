"use client";

import { ChevronRight, Play, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { adminQueueSummary, type AdminStatus } from "../../lib/moderation";
import { useAdminStatus } from "../../lib/use-admin-status";

// Vitrinim'de yalnızca yöneticiye görünen "İlan Onay Paneli" girişi: bekleyen
// onay sayısı rozette; "İncele" seri incelemeyi doğrudan açar
// (/admin/reports?incele=1). Yönetici olup olmadığını sunucu söyler
// (/api/admin/status); yönetici listesi tarayıcıya gelmez.

export const ADMIN_PANEL_PATH = "/admin/reports";
export const ADMIN_REVIEW_PATH = "/admin/reports?incele=1";

export default function AdminEntryCard({ className = "" }: { className?: string }) {
  const status = useAdminStatus();
  return status?.admin ? <AdminEntryCardView status={status} className={className} /> : null;
}

/** Görünüm (testlerde doğrudan çizilir) */
export function AdminEntryCardView({
  status,
  className = "",
}: {
  status: Extract<AdminStatus, { admin: true }>;
  className?: string;
}) {
  const pending = status.pendingListings ?? 0;
  return (
    <section
      aria-label="Yönetim"
      className={`flex items-center gap-2 rounded-2xl bg-white p-2 pr-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)] ${className}`}
    >
      <Link
        href={ADMIN_PANEL_PATH}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 transition-colors hover:bg-[#F7F8FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
      >
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EAEFF7] text-[#003399]">
          <ShieldCheck aria-hidden="true" className="h-6 w-6" />
          {pending > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-1.5 -top-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#FF3040] px-1 text-[11px] font-bold leading-none text-white shadow-[0_0_0_2px_#fff] tabular-nums"
            >
              {pending > 99 ? "99+" : pending}
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-[15.5px] font-semibold leading-tight text-[#15181C]">İlan Onay Paneli</span>
          <span className="mt-0.5 block truncate text-[13px] text-[#5B616B]">{adminQueueSummary(status)}</span>
        </span>
      </Link>
      {pending > 0 ? (
        <Link
          href={ADMIN_REVIEW_PATH}
          aria-label={`İncele: ${pending} ilan onay bekliyor`}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[#003399] px-3.5 text-[14px] font-semibold text-white transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
        >
          <Play aria-hidden="true" className="h-3.5 w-3.5" fill="currentColor" />
          İncele
        </Link>
      ) : (
        <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-[#8A9099]" />
      )}
    </section>
  );
}
