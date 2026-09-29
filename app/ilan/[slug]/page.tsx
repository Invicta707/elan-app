import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import FavoriteButton from "../../../components/FavoriteButton";
import ReportButton from "../../../components/ReportButton";
import SellerCard from "../../../components/social/SellerCard";
import BackButton from "../../../components/vehicle/BackButton";
import SpecsTable, { formatVehiclePrice } from "../../../components/vehicle/SpecsTable";
import { VehiclePageActions, VehiclePageGallery } from "../../../components/vehicle/VehiclePageClient";
import { fetchSellerProfiles } from "../../../lib/follows";
import { currentSiteUrl } from "../../../lib/site-url";
import { buildVehicleShareText, buildVehicleTitle, fetchVehiclePage } from "../../../lib/vehicle-page";
import { buildVehicleJsonLd, buildVehicleMetadata, serializeJsonLd } from "../../../lib/vehicle-seo";
import { LISTING_BASE_PATH, parseListingSegment, vehicleListingPath } from "../../../lib/vehicle-slug";
import { bodyFont, displayFont } from "../../fonts";

type VehiclePageProps = {
  params: Promise<{ slug: string }>;
};

// Adres: /ilan/<yıl>-<marka>-<model>-<kasa>-<il>-<ilan-id> (lib/vehicle-slug.ts).
// İlan sondaki kimlikten okunur; slug eksik ya da eskiyse tam adrese kalıcı
// yönlendirilir (308). Eski /vehicles/<id> adresleri 301 ile buraya gelir.
//
// Sunucu anonim okur: RLS gereği sadece yayındaki ilanlar gelir, satılmış ya
// da kaldırılmış ilanın linki not-found.tsx'e düşer.
// generateMetadata ve sayfa aynı isteği paylaşır: veritabanına tek sorgu
const getVehicle = cache(fetchVehiclePage);

async function vehicleFromParams(params: VehiclePageProps["params"]) {
  const { slug } = await params;
  const parsed = parseListingSegment(slug);
  return { slug, vehicle: parsed ? await getVehicle(parsed.id) : null };
}

export async function generateMetadata({ params }: VehiclePageProps): Promise<Metadata> {
  const { vehicle } = await vehicleFromParams(params);
  if (!vehicle) return { title: "İlan bulunamadı | gözüyle" };
  return buildVehicleMetadata(vehicle);
}

export default async function VehiclePage({ params }: VehiclePageProps) {
  const { slug, vehicle } = await vehicleFromParams(params);
  if (!vehicle) notFound();

  const canonicalPath = vehicleListingPath(vehicle);
  if (`${LISTING_BASE_PATH}/${slug}` !== canonicalPath) permanentRedirect(canonicalPath);

  const title = `${vehicle.brandName} ${vehicle.modelName}`;
  // Satıcı kartı: okunamazsa sayfa kartsız çizilir
  const seller = vehicle.sellerId
    ? ((await fetchSellerProfiles([vehicle.sellerId]).catch(() => []))[0] ?? null)
    : null;

  return (
    <main
      className={`${displayFont.variable} ${bodyFont.variable} min-h-dvh w-full bg-[#F2F3F5] text-[#15181C] [font-family:var(--font-body)]`}
    >
      {/* schema.org Product + Car: Google fiyatı, modeli ve km'yi sonuçta gösterebilir */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildVehicleJsonLd(vehicle, currentSiteUrl())) }}
      />
      <div className="mx-auto max-w-2xl px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[calc(6rem+var(--bottom-nav-height))]">
        <div className="-ml-2 flex h-14 items-center justify-between">
          <BackButton />
          <FavoriteButton vehicleId={vehicle.id} variant="page" />
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

        {seller && <SellerCard seller={seller} />}

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

        <div className="-ml-2 mt-6 border-t border-[#E3E6EA] pt-3">
          <ReportButton vehicleId={vehicle.id} variant="page" />
        </div>
      </div>

      <VehiclePageActions
        vehicle={vehicle}
        sellerId={vehicle.sellerId}
        sharePath={canonicalPath}
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
