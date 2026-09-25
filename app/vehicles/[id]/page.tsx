import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import BackButton from "../../../components/vehicle/BackButton";
import SpecsTable, { formatVehiclePrice } from "../../../components/vehicle/SpecsTable";
import { VehiclePageActions, VehiclePageGallery } from "../../../components/vehicle/VehiclePageClient";
import { vehiclePath } from "../../../lib/share";
import {
  buildVehicleDescription,
  buildVehicleShareText,
  buildVehicleTitle,
  fetchVehiclePage,
  vehicleOgImage,
} from "../../../lib/vehicle-page";
import { bodyFont, displayFont } from "../../fonts";

type VehiclePageProps = {
  params: Promise<{ id: string }>;
};

// Sunucu anonim okur: RLS gereği sadece yayındaki ilanlar gelir, satılmış ya
// da kaldırılmış ilanın linki not-found.tsx'e düşer.
// generateMetadata ve sayfa aynı isteği paylaşır: veritabanına tek sorgu
const getVehicle = cache(fetchVehiclePage);

export async function generateMetadata({ params }: VehiclePageProps): Promise<Metadata> {
  const { id } = await params;
  const vehicle = await getVehicle(id);
  if (!vehicle) return { title: "İlan bulunamadı | Elan" };

  const title = buildVehicleTitle(vehicle);
  const description = buildVehicleDescription(vehicle);
  const image = vehicleOgImage(vehicle);
  const path = vehiclePath(vehicle.id);

  return {
    title,
    description,
    alternates: { canonical: path },
    // WhatsApp ve sosyal medyada link, aracın fotoğrafıyla kart olarak görünür
    openGraph: {
      type: "website",
      siteName: "Elan",
      locale: "tr_TR",
      url: path,
      title,
      description,
      images: image ? [{ url: image, alt: `${vehicle.brandName} ${vehicle.modelName}` }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function VehiclePage({ params }: VehiclePageProps) {
  const { id } = await params;
  const vehicle = await getVehicle(id);
  if (!vehicle) notFound();

  const title = `${vehicle.brandName} ${vehicle.modelName}`;

  return (
    <main
      className={`${displayFont.variable} ${bodyFont.variable} min-h-dvh w-full bg-[#F2F3F5] text-[#15181C] [font-family:var(--font-body)]`}
    >
      <div className="mx-auto max-w-2xl px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[calc(6rem+var(--bottom-nav-height))]">
        <div className="-ml-2 flex h-14 items-center">
          <BackButton />
        </div>

        {vehicle.photoUrls.length > 0 ? (
          <div className="mb-5">
            <VehiclePageGallery photos={vehicle.photoUrls} title={title} />
          </div>
        ) : (
          vehicle.videoThumbnailUrl && (
            <div className="relative mb-5 aspect-[4/3] w-full overflow-hidden rounded-lg bg-[#E6E8EB]">
              <Image
                src={vehicle.videoThumbnailUrl}
                alt=""
                fill
                sizes="(min-width: 672px) 640px, 100vw"
                loading="eager"
                className="object-cover"
              />
            </div>
          )
        )}

        <h1 className="text-[28px] font-semibold leading-tight [font-family:var(--font-display)]">{title}</h1>
        <p className="mt-1 text-[24px] font-extrabold tabular-nums [font-family:var(--font-display)]">
          {formatVehiclePrice(vehicle.price, vehicle.currency)}
        </p>

        {vehicle.hasPlayableVideo && (
          <Link
            href={`/?v=${vehicle.id}`}
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-[#15181C] px-4 text-[14px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
          >
            <PlayIcon className="h-4 w-4" />
            Videoyu akışta izle
          </Link>
        )}

        <div className="mt-6">
          <SpecsTable specs={vehicle} headingId="vehicle-specs" />
        </div>

        {vehicle.description && (
          <section aria-labelledby="vehicle-desc" className="mt-6">
            <h2 id="vehicle-desc" className="mb-2 text-[15px] font-semibold">
              Satıcının açıklaması
            </h2>
            <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-[#2A2F36]">
              {vehicle.description}
            </p>
          </section>
        )}
      </div>

      <VehiclePageActions
        vehicle={vehicle}
        shareTitle={buildVehicleTitle(vehicle)}
        shareText={buildVehicleShareText(vehicle)}
      />
    </main>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.9-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z"
        fill="currentColor"
      />
    </svg>
  );
}
