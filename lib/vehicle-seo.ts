import type { Metadata } from "next";
import { BODY_TYPE_LABELS, FUEL_LABELS, TRANSMISSION_LABELS } from "./vehicle-labels";
import { buildVehicleDescription, buildVehicleTitle, vehicleOgImagePath, type VehiclePageData } from "./vehicle-page";
import { vehicleListingPath } from "./vehicle-slug";

// İlanın arama motoru ve paylaşım yüzü: metadata (canonical, OpenGraph,
// Twitter) ve schema.org JSON-LD (Product + Car). İlan sayfası
// (app/ilan/[slug]) ve ilanla açılan ana sayfa (/?v=<id>) kullanır.
// UI'dan bağımsız: testleri lib/vehicle-seo.test.ts'de.

/**
 * canonical her zaman ilanın tam /ilan/… adresi: eski /vehicles/<id>,
 * slug'ı eksik bağlantılar ve /?v=<id> aynı sayfanın kopyası sayılmaz.
 * Deneme ilanları dizine eklenmez.
 */
export function buildVehicleMetadata(vehicle: VehiclePageData): Metadata {
  const title = buildVehicleTitle(vehicle);
  const description = buildVehicleDescription(vehicle);
  const path = vehicleListingPath(vehicle);
  // Araca özel afiş (fiyat plakası, başlık, Yıl / KM / İl, dikey video kartı); yayında olmayan ilanda yok
  const image = vehicle.status === "active" ? vehicleOgImagePath(vehicle) : null;
  const alt = `${vehicle.year} ${vehicle.brandName} ${vehicle.modelName}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    ...(vehicle.isTest ? { robots: { index: false, follow: true } } : {}),
    // WhatsApp ve sosyal medyada link, araca özel afişle kart olarak görünür
    openGraph: {
      type: "website",
      siteName: "gözüyle",
      locale: "tr_TR",
      url: path,
      title,
      description,
      images: image ? [{ url: image, width: 1200, height: 630, alt, type: "image/png" }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [{ url: image, alt }] : undefined,
    },
  };
}

const SCHEMA = "https://schema.org";

/**
 * Google'ın fiyat, model ve kilometreyi gösterebilmesi için ilanın yapılandırılmış
 * verisi: hem Product (fiyat teklifi, marka) hem Car (model yılı, km, yakıt,
 * vites, kasa). Adresler mutlak; km birimi UN/CEFACT "KMT".
 */
export function buildVehicleJsonLd(vehicle: VehiclePageData, siteUrl: URL): Record<string, unknown> {
  const url = new URL(vehicleListingPath(vehicle), siteUrl).toString();
  const name = `${vehicle.year} ${vehicle.brandName} ${vehicle.modelName}`.replace(/\s+/g, " ").trim();
  const images = vehicle.photoUrls.length > 0 ? vehicle.photoUrls : vehicle.videoThumbnailUrl ? [vehicle.videoThumbnailUrl] : [];
  const bodyType = vehicle.bodyType ? BODY_TYPE_LABELS[vehicle.bodyType] : null;

  return {
    "@context": SCHEMA,
    "@type": ["Product", "Car"],
    "@id": `${url}#arac`,
    name,
    url,
    sku: vehicle.id,
    description: vehicle.description ?? buildVehicleDescription(vehicle),
    ...(images.length > 0 ? { image: images } : {}),
    brand: { "@type": "Brand", name: vehicle.brandName },
    model: vehicle.modelName,
    vehicleModelDate: String(vehicle.year),
    mileageFromOdometer: { "@type": "QuantitativeValue", value: vehicle.mileageKm, unitCode: "KMT", unitText: "km" },
    fuelType: FUEL_LABELS[vehicle.fuelType] ?? vehicle.fuelType,
    vehicleTransmission: TRANSMISSION_LABELS[vehicle.transmission] ?? vehicle.transmission,
    ...(bodyType ? { bodyType } : {}),
    itemCondition: `${SCHEMA}/UsedCondition`,
    ...(vehicle.hasHeavyDamage ? { knownVehicleDamages: "Ağır hasar kaydı var" } : {}),
    offers: {
      "@type": "Offer",
      url,
      price: vehicle.price,
      priceCurrency: vehicle.currency,
      availability: vehicle.status === "active" ? `${SCHEMA}/InStock` : `${SCHEMA}/SoldOut`,
      itemCondition: `${SCHEMA}/UsedCondition`,
      ...(vehicle.city
        ? {
            availableAtOrFrom: {
              "@type": "Place",
              address: { "@type": "PostalAddress", addressLocality: vehicle.city, addressCountry: "TR" },
            },
          }
        : {}),
    },
  };
}

/**
 * <script type="application/ld+json"> içeriği. Satıcının yazdığı metin
 * (açıklama, model adı) "</script>" ile betik bloğunu kapatamasın diye "<"
 * kaçırılır (Next.js JSON-LD kılavuzu).
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
