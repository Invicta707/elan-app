import type { FuelType, TransmissionType } from "./feed";
import { isUuid } from "./feed";
import type { VehicleStatus } from "./listing-status";
import { currencySymbol, formatAmount, type BodyType } from "./search";
import { supabase } from "./supabase";
import { FUEL_LABELS, TRANSMISSION_LABELS } from "./vehicle-labels";
import { vehicleIdPath, vehicleListingPath } from "./vehicle-slug";

// /ilan/[slug]: paylaşılabilir ilan sayfasının verisi ve SEO/OpenGraph metinleri.

export type VehicleSpecs = {
  brandName: string;
  modelName: string;
  year: number;
  mileageKm: number;
  price: number;
  currency: string;
  fuelType: FuelType;
  transmission: TransmissionType;
  /** undefined: henüz yükleniyor (çekmece kasa tipini sonradan ister) */
  bodyType: BodyType | null | undefined;
  city: string | null;
  hasHeavyDamage: boolean;
};

export type VehiclePageData = VehicleSpecs & {
  id: string;
  /** Kendi ilanında "Mesaj gönder" gizlenir */
  sellerId: string | null;
  status: VehicleStatus;
  description: string | null;
  /** Kapak (is_primary) başta, sonra sırayla */
  photoUrls: string[];
  /** Fotoğraf yoksa paylaşım kartında kullanılan video kapağı */
  videoThumbnailUrl: string | null;
  hasPlayableVideo: boolean;
  /** Deneme ilanı (paylaşım afişinde "TEST İLANI"); yalnızca true iken yazılır */
  isTest?: boolean;
};

export type VehiclePageRow = {
  id: string;
  seller_id?: string | null;
  status: VehicleStatus;
  year: number;
  price: number | string;
  currency: string;
  mileage_km: number;
  fuel_type: FuelType;
  transmission: TransmissionType;
  body_type: BodyType | null;
  city: string | null;
  has_heavy_damage: boolean;
  description: string | null;
  is_test?: boolean | null;
  brand: { name: string } | null;
  model: { name: string } | null;
  images: { image_url: string | null; is_primary: boolean; display_order: number }[] | null;
  videos: { status: string; hls_url: string | null; thumbnail_url: string | null }[] | null;
};

export function toVehiclePage(row: VehiclePageRow): VehiclePageData {
  const photoUrls = [...(row.images ?? [])]
    .filter((i) => i.image_url)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.display_order - b.display_order)
    .map((i) => i.image_url as string);
  const videos = row.videos ?? [];
  const readyVideo = videos.find((v) => v.status === "ready" && v.hls_url);

  return {
    id: row.id,
    sellerId: row.seller_id ?? null,
    status: row.status,
    brandName: row.brand?.name ?? "",
    modelName: row.model?.name ?? "",
    year: row.year,
    mileageKm: row.mileage_km,
    price: Number(row.price),
    currency: row.currency,
    fuelType: row.fuel_type,
    transmission: row.transmission,
    bodyType: row.body_type,
    city: row.city,
    hasHeavyDamage: row.has_heavy_damage,
    description: row.description?.trim() || null,
    photoUrls,
    videoThumbnailUrl: readyVideo?.thumbnail_url ?? videos.find((v) => v.thumbnail_url)?.thumbnail_url ?? null,
    hasPlayableVideo: Boolean(readyVideo),
    ...(row.is_test === true ? { isTest: true } : {}),
  };
}

/**
 * Yayında olmayan (satılmış, kaldırılmış) ilanlar da RLS izin verdiği ölçüde
 * gelir; sayfa onları "yayında değil" notuyla gösterir. Bulunamazsa null.
 */
export async function fetchVehiclePage(id: string): Promise<VehiclePageData | null> {
  if (!isUuid(id)) return null;

  const { data, error } = await supabase
    .from("vehicles")
    .select(
      `id, seller_id, status, year, price, currency, mileage_km, fuel_type, transmission, body_type,
       city, has_heavy_damage, description, is_test,
       brand:brands(name),
       model:models(name),
       images:vehicle_images(image_url, is_primary, display_order),
       videos(status, hls_url, thumbnail_url)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? toVehiclePage(data as unknown as VehiclePageRow) : null;
}

type ListingPathRow = {
  id: string;
  year: number;
  body_type: BodyType | null;
  city: string | null;
  brand: { name: string } | null;
  model: { name: string } | null;
};

/**
 * Eski /vehicles/<id> adresinin 301 hedefi: ilanın tam /ilan/… yolu. İlan
 * okunamazsa (yayında değil, yok, kimlik bozuk) /ilan/<id>: orası 404 verir.
 */
export async function fetchListingPath(id: string): Promise<string> {
  if (!isUuid(id)) return vehicleIdPath(id);

  const { data, error } = await supabase
    .from("vehicles")
    .select("id, year, body_type, city, brand:brands(name), model:models(name)")
    .eq("id", id)
    .maybeSingle();

  if (error) console.error("İlan adresi okunamadı:", error);
  if (error || !data) return vehicleIdPath(id.toLowerCase());
  const row = data as unknown as ListingPathRow;
  return vehicleListingPath({
    id: row.id,
    year: row.year,
    brandName: row.brand?.name ?? "",
    modelName: row.model?.name ?? "",
    bodyType: row.body_type,
    city: row.city,
  });
}

// ---------------------------------------------------------------
// Başlık, açıklama ve paylaşım metinleri
// ---------------------------------------------------------------

type TitleInput = Pick<VehicleSpecs, "year" | "brandName" | "modelName" | "price" | "currency">;

function formatPrice(price: number, currency: string): string {
  return `${currencySymbol(currency)}${formatAmount(price)}`;
}

/** "2021 Porsche 911 Carrera S - ₺3.450.000" */
export function buildVehicleTitle(v: TitleInput): string {
  return `${v.year} ${v.brandName} ${v.modelName} - ${formatPrice(v.price, v.currency)}`;
}

/** "85.000 km · Benzin · Otomatik · İstanbul. gözüyle'de videolu araç ilanı." */
export function buildVehicleDescription(
  v: Pick<VehicleSpecs, "mileageKm" | "fuelType" | "transmission" | "city" | "hasHeavyDamage">,
): string {
  const parts = [
    `${formatAmount(v.mileageKm)} km`,
    FUEL_LABELS[v.fuelType] ?? v.fuelType,
    TRANSMISSION_LABELS[v.transmission] ?? v.transmission,
    v.city,
  ].filter(Boolean);
  const damage = v.hasHeavyDamage ? " Ağır hasar kayıtlı." : "";
  return `${parts.join(" · ")}.${damage} gözüyle'de videolu araç ilanı.`;
}

/** Paylaşım menüsünde bağlantının yanında giden kısa metin */
export function buildVehicleShareText(v: TitleInput): string {
  return `gözüyle'de ${buildVehicleTitle(v)}`;
}

/** Paylaşım afişi (1200×630, app/api/og/vehicle/[id]/route.tsx); ilan fiyatı değişince adres de değişir */
export function vehicleOgImagePath(v: Pick<VehiclePageData, "id" | "price">): string {
  return `/api/og/vehicle/${v.id}?v=${encodeURIComponent(String(v.price))}`;
}

/** Paylaşım kartı görseli: kapak fotoğrafı, yoksa video kapağı */
export function vehicleOgImage(v: Pick<VehiclePageData, "photoUrls" | "videoThumbnailUrl">): string | null {
  return v.photoUrls[0] ?? v.videoThumbnailUrl;
}
