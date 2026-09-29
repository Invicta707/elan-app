import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { currencySpoken, currencySymbol, formatAmount, type VehicleCardData } from "../lib/search";
import { vehicleListingPath } from "../lib/vehicle-slug";

// Arama sonuçları ve favoriler grid'indeki ilan kartı. Kancasız: hem sunucu hem
// istemci bileşenlerinde kullanılabilir.
export default function VehicleGridCard({
  vehicle,
  eager,
  action,
}: {
  vehicle: VehicleCardData;
  eager: boolean;
  /** Fotoğrafın sağ üst köşesindeki buton (ör. favori). Bağlantının dışında durur: iç içe etkileşimli öğe olmaz. */
  action?: ReactNode;
}) {
  const imageUrl = vehicle.coverImageUrl ?? vehicle.videoThumbnailUrl;
  const title = `${vehicle.brandName} ${vehicle.modelName}`;

  // Her kart ilanın kalıcı sayfasına gider; videolu ilanda oradaki
  // "Videoyu akışta izle" bağlantısı akışı bu ilanla açar (/?v=<id>)
  return (
    <div className="relative">
      <Link
        href={vehicleListingPath(vehicle)}
        className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F2F3F5]"
      >
        <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-[#DDE1E6]">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt=""
              fill
              sizes="(min-width: 1024px) 240px, (min-width: 768px) 33vw, 50vw"
              loading={eager ? "eager" : "lazy"}
              className="object-cover"
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-[13px] text-[#5B616B]">
              Fotoğraf yok
            </span>
          )}

          {vehicle.hasPlayableVideo && <VideoBadge />}

          <SmallPricePlate
            price={vehicle.price}
            currency={vehicle.currency}
            className="absolute bottom-2 left-2"
          />
        </div>

        <h3 className="mt-2 truncate text-[17px] font-semibold leading-tight [font-family:var(--font-display)]">
          {title}
        </h3>
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-[#4A5058]">
          <span>{vehicle.year}</span>
          <span>{formatAmount(vehicle.mileageKm)} km</span>
        </p>
        {vehicle.city && (
          <p className="mt-0.5 flex items-center gap-1 text-[13px] text-[#4A5058]">
            <PinIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{vehicle.city}</span>
          </p>
        )}
        <span className="sr-only">, ilan detayını aç</span>
      </Link>

      {action && <div className="absolute right-2 top-2">{action}</div>}
    </div>
  );
}

function VideoBadge() {
  return (
    <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 py-0.5 pl-1.5 pr-2 text-[12px] font-semibold text-white ring-1 ring-inset ring-white/15 backdrop-blur-[6px]">
      <PlayIcon className="h-3 w-3" />
      Video
    </span>
  );
}

// Akıştaki fiyat plakasının küçük hâli: soldaki mavi şeritte para birimi
function SmallPricePlate({
  price,
  currency,
  className = "",
}: {
  price: number;
  currency: string;
  className?: string;
}) {
  return (
    <p
      className={`inline-flex h-7 items-stretch overflow-hidden rounded-[4px] border-[1.5px] border-black bg-white text-black shadow-[0_2px_0_rgba(0,0,0,0.35)] ${className}`}
    >
      <span
        aria-hidden="true"
        className="flex w-5 items-center justify-center bg-[#003399] text-[11px] font-semibold text-white"
      >
        {currencySymbol(currency)}
      </span>
      <span className="flex items-center px-1.5 text-[17px] font-extrabold leading-none tabular-nums [font-family:var(--font-display)]">
        {formatAmount(price)}
        <span className="sr-only"> {currencySpoken(currency)}</span>
      </span>
    </p>
  );
}

type IconProps = { className?: string };

function PinIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.25" />
    </svg>
  );
}

function PlayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.9-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z"
        fill="currentColor"
      />
    </svg>
  );
}
