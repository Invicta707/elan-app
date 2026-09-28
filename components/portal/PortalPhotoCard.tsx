"use client";

import { MapPin, Play } from "lucide-react";
import Image from "next/image";
import type { MouseEvent } from "react";
import { formatListingDate, type PortalVehicle } from "../../lib/portal";
import { currencySymbol, formatAmount } from "../../lib/search";
import { vehiclePath } from "../../lib/share";
import { FUEL_LABELS, TRANSMISSION_LABELS } from "../../lib/vehicle-labels";
import { ListingBadges } from "./PortalCard";

// "Görselli ilanlar" ızgarasının klasik ilan kartı (llex.az / turbo.az gibi):
// yatay (4:3) kapak fotoğrafı, altında kalın fiyat, başlık, yıl · km · yakıt ·
// vites ve il · eklenme günü. Videolu ilanda kapakta küçük "Video" rozeti.
// Tıklamak vitrin penceresini açar (video + ayrıntılar); Ctrl/orta tık yeni
// sekmede ilan sayfası.

export default function PortalPhotoCard({
  vehicle,
  eager,
  onOpen,
  linkRef,
  now,
}: {
  vehicle: PortalVehicle;
  eager: boolean;
  onOpen: () => void;
  /** Pencere kapanınca odak bu karta döner */
  linkRef?: (element: HTMLAnchorElement | null) => void;
  now: Date;
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen();
  }

  const title = `${vehicle.brandName} ${vehicle.modelName}`;
  const price = `${formatAmount(vehicle.price)} ${vehicle.currency === "TRY" ? "TL" : currencySymbol(vehicle.currency)}`;
  const specs = [
    String(vehicle.year),
    `${formatAmount(vehicle.mileageKm)} km`,
    FUEL_LABELS[vehicle.fuelType] ?? vehicle.fuelType,
    TRANSMISSION_LABELS[vehicle.transmission] ?? vehicle.transmission,
  ].join(" · ");
  const date = vehicle.createdAt ? formatListingDate(vehicle.createdAt, now) : "";
  const place = [vehicle.city, date].filter(Boolean).join(" · ");

  return (
    <a
      ref={linkRef}
      href={vehiclePath(vehicle.id)}
      onClick={handleClick}
      aria-haspopup="dialog"
      data-photo-card={vehicle.id}
      className="group block overflow-hidden rounded-xl bg-[#18181B] ring-1 ring-inset ring-[#27272A] transition-colors hover:ring-[#3F3F46] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      <span className="relative block aspect-[4/3] overflow-hidden bg-[#27272A]">
        {vehicle.photoUrl && (
          <Image
            src={vehicle.photoUrl}
            alt=""
            fill
            sizes="(min-width: 1280px) 20vw, 25vw"
            loading={eager ? "eager" : "lazy"}
            className="object-cover transition-transform duration-300 ease-out motion-safe:group-hover:scale-[1.03]"
          />
        )}
        <ListingBadges isTest={vehicle.isTest} hasHeavyDamage={vehicle.hasHeavyDamage} />
        {vehicle.hlsUrl && (
          <span className="pointer-events-none absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-black/60 py-0.5 pr-2 pl-1.5 text-[12px] font-semibold text-white ring-1 ring-inset ring-white/15">
            <Play aria-hidden="true" className="h-3 w-3 fill-current" />
            Video
          </span>
        )}
      </span>

      <span className="block px-3 pt-2.5 pb-3">
        <span className="block truncate text-[18px] font-extrabold leading-tight tabular-nums text-white [font-family:var(--font-display)]">
          {price}
        </span>
        <span className="mt-1 block truncate text-[15px] font-semibold text-[#E4E4E7]">{title}</span>
        <span className="mt-0.5 block truncate text-[13px] text-[#A1A1AA]">{specs}</span>
        {place && (
          <span className="mt-1.5 flex items-center gap-1 text-[12.5px] text-[#71717A]">
            <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{place}</span>
          </span>
        )}
        <span className="sr-only">, ayrıntıları aç</span>
      </span>
    </a>
  );
}
