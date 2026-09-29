"use client";

import { Archive, BadgeCheck, CirclePlay, ExternalLink, Rocket, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  STATUS_LABELS,
  canTransition,
  statusActions,
  type StatusAction,
  type VehicleStatus,
} from "../../lib/listing-status";
import { updateListingStatus, type MyListing } from "../../lib/my-listings";
import {
  LISTING_AWAITING_APPROVAL_MESSAGE,
  LISTING_IN_REVIEW_MESSAGE,
  LISTING_REJECTED_MESSAGE,
} from "../../lib/content-moderation";
import { formatTilePrice, isContentRejected } from "../../lib/showcase";
import { vehicleIdPath } from "../../lib/vehicle-slug";
import BottomSheet, { type SheetAction } from "../ui/BottomSheet";

// Vitrindeki bir ilanın menüsü: görüntüle, akışta gör, durum değiştir.
// Geçiş kuralları lib/listing-status.ts ve veritabanında (set_vehicle_status).

const ACTION_ICON: Partial<Record<VehicleStatus, ReactNode>> = {
  active: <Rocket className="h-5 w-5" />,
  sold: <BadgeCheck className="h-5 w-5" />,
  archived: <Archive className="h-5 w-5" />,
};

export default function ListingManageSheet({
  listing,
  onClose,
  onStatusChanged,
}: {
  listing: MyListing;
  onClose: () => void;
  onStatusChanged: (status: VehicleStatus) => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<StatusAction | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(action: StatusAction) {
    setPending(true);
    setError(null);
    try {
      onStatusChanged(await updateListingStatus(listing.id, action.target));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "İlan durumu güncellenemedi.");
      setConfirming(null);
    } finally {
      setPending(false);
    }
  }

  const header = (
    <div className="px-5 pb-2 text-center">
      <p className="truncate text-[17px] font-semibold text-[#15181C]">
        {listing.title} · {listing.year}
      </p>
      <p className="mt-0.5 text-[14px] text-[#5B616B]">
        {formatTilePrice(listing.price, listing.currency)} ·{" "}
        {isContentRejected(listing) ? "Yayınlanmadı" : STATUS_LABELS[listing.status]}
      </p>
      {isContentRejected(listing) && (
        <p className="mx-auto mt-2 max-w-xs rounded-xl bg-[#FDEDEC] px-3 py-2 text-[13px] text-[#B42318]">
          {LISTING_REJECTED_MESSAGE}
        </p>
      )}
      {(listing.status === "pending_moderation" || listing.status === "pending_approval") && (
        <p className="mx-auto mt-2 max-w-xs rounded-xl bg-[#EEF2FA] px-3 py-2 text-[13px] text-[#1F3B7A]">
          {listing.status === "pending_approval" ? LISTING_AWAITING_APPROVAL_MESSAGE : LISTING_IN_REVIEW_MESSAGE}
        </p>
      )}
      {canTransition(listing.status, "active") && !listing.hasPlayableVideo && (
        <p className="mx-auto mt-2 max-w-xs rounded-xl bg-[#FEF6E7] px-3 py-2 text-[13px] text-[#8A6116]">
          Yayına almak için videonun işlenmesi gerekiyor.
        </p>
      )}
      {canTransition(listing.status, "active") && listing.hasPlayableVideo && listing.moderationStatus !== "approved" && (
        <p className="mx-auto mt-2 max-w-xs rounded-xl bg-[#FEF6E7] px-3 py-2 text-[13px] text-[#8A6116]">
          Yayına almak için içerik denetiminin tamamlanması gerekiyor.
        </p>
      )}
      <div role="status" aria-live="polite">
        {error && <p className="mt-2 rounded-xl bg-[#FDEDEC] px-3 py-2 text-[13px] text-[#B42318]">{error}</p>}
      </div>
    </div>
  );

  if (confirming) {
    return (
      <BottomSheet title="Emin misin?" onClose={() => setConfirming(null)}>
        <div className="px-5 pb-2">
          <p className="text-center text-[15px] text-[#15181C]">{confirming.confirm}</p>
          <button
            type="button"
            disabled={pending}
            onClick={() => void apply(confirming)}
            className="mt-4 h-12 w-full rounded-2xl bg-[#D92D20] text-[16px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#D92D20]/30"
          >
            {pending ? "Kaydediliyor…" : "Evet, işaretle"}
          </button>
        </div>
      </BottomSheet>
    );
  }

  const actions: SheetAction[] = [];
  if (listing.status === "active") {
    actions.push({
      label: "İlanı görüntüle",
      icon: <ExternalLink className="h-5 w-5" />,
      onSelect: () => router.push(vehicleIdPath(listing.id)),
    });
    if (listing.hasPlayableVideo) {
      actions.push({ label: "Akışta gör", icon: <CirclePlay className="h-5 w-5" />, onSelect: () => router.push(`/?v=${listing.id}`) });
    }
  }
  for (const action of statusActions(listing.status, {
    hasPlayableVideo: listing.hasPlayableVideo,
    moderationStatus: listing.moderationStatus,
  })) {
    actions.push({
      label: pending ? "Kaydediliyor…" : action.label,
      icon: ACTION_ICON[action.target] ?? <Undo2 className="h-5 w-5" />,
      tone: action.tone === "danger" ? "danger" : "default",
      onSelect: () => (pending ? undefined : action.confirm ? setConfirming(action) : void apply(action)),
    });
  }

  return (
    <BottomSheet title="İlanı yönet" onClose={onClose} actions={actions}>
      {header}
    </BottomSheet>
  );
}
