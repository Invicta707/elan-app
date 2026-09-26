"use client";

import { useState } from "react";
import MessageSellerButton from "./MessageSellerButton";
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
  sellerId,
  shareTitle,
  shareText,
}: {
  vehicle: SellerContactVehicle;
  sellerId: string | null;
  shareTitle: string;
  shareText: string;
}) {
  const { contact, isContacting, notice } = useSellerContact(vehicle);
  const [messageNotice, setMessageNotice] = useState<string | null>(null);

  return (
    <div className="fixed inset-x-0 bottom-[var(--bottom-nav-height)] z-30 border-t border-[#E3E6EA] bg-white px-4 pt-3 pb-3 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-2xl">
        <div role="status" aria-live="polite">
          {(messageNotice ?? notice) && (
            <p className="mb-2 text-center text-[13px] text-[#B42318]">{messageNotice ?? notice}</p>
          )}
        </div>
        {/* İki iletişim yolu eşit ağırlıkta; paylaş yalnızca simge */}
        <div className="@container flex gap-2">
          <ShareButton vehicleId={vehicle.id} title={shareTitle} text={shareText} variant="icon" className="shrink-0" />
          <MessageSellerButton vehicleId={vehicle.id} sellerId={sellerId} onNotice={setMessageNotice} className="min-w-0 flex-1" />
          <WhatsAppButton onClick={contact} isContacting={isContacting} className="min-w-0 flex-1" />
        </div>
      </div>
    </div>
  );
}
