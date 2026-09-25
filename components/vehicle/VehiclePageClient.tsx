"use client";

import { useState } from "react";
import PhotoGallery from "./PhotoGallery";
import ShareButton from "./ShareButton";
import { useSellerContact } from "./useSellerContact";
import WhatsAppButton from "./WhatsAppButton";
import type { SellerContactVehicle } from "../../lib/feed";

// /vehicles/[id] sayfasının etkileşimli parçaları; sayfanın geri kalanı sunucuda çizilir.

export function VehiclePageGallery({ photos, title }: { photos: string[]; title: string }) {
  // Tam ekran görüntüleyici body'ye çizilir; sunucuda null (görüntüleyici
  // ancak dokunulunca açıldığından ilk HTML aynı kalır)
  const [container] = useState<Element | null>(() => (typeof document === "undefined" ? null : document.body));
  return <PhotoGallery photos={photos} title={title} lightboxContainer={container} eagerFirst />;
}

export function VehiclePageActions({
  vehicle,
  shareTitle,
  shareText,
}: {
  vehicle: SellerContactVehicle;
  shareTitle: string;
  shareText: string;
}) {
  const { contact, isContacting, notice } = useSellerContact(vehicle);

  return (
    <div className="fixed inset-x-0 bottom-[var(--bottom-nav-height)] z-30 border-t border-[#E3E6EA] bg-white px-4 pt-3 pb-3 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-2xl">
        <div role="status" aria-live="polite">
          {notice && <p className="mb-2 text-center text-[13px] text-[#B42318]">{notice}</p>}
        </div>
        <div className="flex gap-2">
          <ShareButton vehicleId={vehicle.id} title={shareTitle} text={shareText} className="flex-1" />
          <WhatsAppButton onClick={contact} isContacting={isContacting} className="flex-[1.25]" />
        </div>
      </div>
    </div>
  );
}
