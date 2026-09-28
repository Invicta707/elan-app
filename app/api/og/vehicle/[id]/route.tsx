import { ImageResponse } from "next/og";
import {
  OG_CACHE_CONTROL,
  OG_SIZE,
  VehicleOgImage,
  fetchImageDataUrl,
  loadOgFonts,
  ogImageSources,
  ogText,
  type OgVehicle,
} from "../../../../../lib/og-vehicle";
import { fetchVehiclePage } from "../../../../../lib/vehicle-page";

// GET /api/og/vehicle/[id]: ilanın paylaşım afişi (PNG, 1200×630). İlan
// sayfasının OpenGraph ve Twitter kartı bu adresi gösterir. Yalnızca yayındaki
// ilan (misafir okuması, RLS); yoksa 404. Görsel ya da yazı tipi indirilemezse
// afiş onlarsız çizilir. CDN'de bir gün tutulur; fiyat değişince sayfadaki
// adres (?v=fiyat) de değişir.

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const vehicle = await fetchVehiclePage(id).catch((error) => {
    console.error("Paylaşım afişi: ilan okunamadı:", error);
    return null;
  });
  if (!vehicle || vehicle.status !== "active") {
    return new Response("İlan bulunamadı", { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
  }

  const og: OgVehicle = {
    brandName: vehicle.brandName,
    modelName: vehicle.modelName,
    year: vehicle.year,
    mileageKm: vehicle.mileageKm,
    city: vehicle.city,
    price: vehicle.price,
    currency: vehicle.currency,
    isTest: vehicle.isTest === true,
  };
  const sources = ogImageSources(vehicle);
  const [background, poster, fonts] = await Promise.all([
    fetchImageDataUrl(sources.background),
    // Aynı adres iki kez indirilmesin
    sources.poster === sources.background ? Promise.resolve(null) : fetchImageDataUrl(sources.poster),
    loadOgFonts(ogText(og)),
  ]);

  return new ImageResponse(<VehicleOgImage vehicle={og} images={{ background, poster: poster ?? background }} />, {
    ...OG_SIZE,
    fonts,
    headers: { "Cache-Control": OG_CACHE_CONTROL },
  });
}
