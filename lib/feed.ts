import { normalizeTurkishPhone } from "./phone";
import type { BodyType } from "./search";
import { supabase } from "./supabase";

// Bu dosya UI'dan bağımsızdır: ileride React Native uygulaması da
// aynı sorguları ve tipleri doğrudan kullanabilir.

export type FuelType = "benzin" | "dizel" | "lpg" | "hibrit" | "elektrik";
export type TransmissionType = "manuel" | "otomatik";

export type FeedVehicle = {
  id: string;
  brandName: string;
  modelName: string;
  year: number;
  price: number;
  currency: string;
  mileageKm: number;
  fuelType: FuelType;
  transmission: TransmissionType;
  city: string | null;
  tramerAmount: number;
  hasHeavyDamage: boolean;
  paintedPartsCount: number;
  changedPartsCount: number;
  hlsUrl: string;
  thumbnailUrl: string | null;
};

export type FeedCursor = { createdAt: string; id: string };

export type FeedPage = {
  items: FeedVehicle[];
  nextCursor: FeedCursor | null;
  hasMore: boolean;
};

// PostgREST'in döndürdüğü ham satır (snake_case)
type FeedRow = {
  id: string;
  created_at: string;
  year: number;
  price: number | string;
  currency: string;
  mileage_km: number;
  fuel_type: FuelType;
  transmission: TransmissionType;
  city: string | null;
  tramer_amount: number | string;
  has_heavy_damage: boolean;
  painted_parts_count: number;
  changed_parts_count: number;
  brand: { name: string } | null;
  model: { name: string } | null;
  videos: { hls_url: string | null; thumbnail_url: string | null; order_index: number }[];
};

// videos!inner: yalnızca en az bir "ready" videosu olan araçlar döner.
// Satıcı, RLS izin verdiği için status'ü elle 'active' yapsa bile
// videosuz bir ilan feed'e sızmaz.
const FEED_COLUMNS = `
  id, created_at, year, price, currency, mileage_km, fuel_type, transmission, city,
  tramer_amount, has_heavy_damage, painted_parts_count, changed_parts_count,
  brand:brands(name),
  model:models(name),
  videos!inner(hls_url, thumbnail_url, order_index)
`;

export async function fetchFeedPage(cursor: FeedCursor | null, pageSize = 8): Promise<FeedPage> {
  let query = supabase
    .from("vehicles")
    .select(FEED_COLUMNS)
    .eq("status", "active")
    .eq("videos.status", "ready")
    .not("videos.hls_url", "is", null);

  if (cursor) {
    // Keyset (cursor) sayfalama, OFFSET yerine:
    //   created_at <= cursor → idx_vehicles_feed_active kısmi indeksinde
    //   kaldığı yerden okumaya başlar (sayfa ne kadar derin olursa olsun
    //   sadece pageSize kadar satır okunur, bkz. 002 migration'ı)
    //   (created_at < cursor OR id < cursorId) → aynı created_at'e sahip
    //   ilanlar (örn. tek transaction'da eklenen test verisi) sayfa
    //   sınırında atlanmaz ya da tekrarlanmaz.
    // Zaman damgası ":" ve "." içerdiği için or() içinde tırnaklanıyor.
    query = query
      .lte("created_at", cursor.createdAt)
      .or(`created_at.lt."${cursor.createdAt}",id.lt.${cursor.id}`);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .order("order_index", { referencedTable: "videos", ascending: true })
    .limit(1, { referencedTable: "videos" })
    .limit(pageSize);

  if (error) throw error;

  const rows = (data ?? []) as unknown as FeedRow[];
  const lastRow = rows[rows.length - 1];

  return {
    items: rows.map(toFeedVehicle).filter((v): v is FeedVehicle => v !== null),
    // created_at string olarak saklanıyor: JS Date'e çevirmek mikrosaniye
    // hassasiyetini kaybettirir ve cursor karşılaştırmasını bozar.
    nextCursor: lastRow ? { createdAt: lastRow.created_at, id: lastRow.id } : cursor,
    hasMore: rows.length === pageSize,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

// İlan sayfasından akışa geçişte (/?v=<id>) ilk sırada gösterilecek ilan.
// Aktif değilse ya da oynatılabilir videosu yoksa null döner.
export async function fetchFeedVehicle(id: string): Promise<FeedVehicle | null> {
  if (!isUuid(id)) return null;

  const { data, error } = await supabase
    .from("vehicles")
    .select(FEED_COLUMNS)
    .eq("id", id)
    .eq("status", "active")
    .eq("videos.status", "ready")
    .not("videos.hls_url", "is", null)
    .order("order_index", { referencedTable: "videos", ascending: true })
    .limit(1, { referencedTable: "videos" })
    .maybeSingle();

  if (error) throw error;
  return data ? toFeedVehicle(data as unknown as FeedRow) : null;
}

function toFeedVehicle(row: FeedRow): FeedVehicle | null {
  const video = row.videos[0];
  if (!video?.hls_url) return null;

  return {
    id: row.id,
    brandName: row.brand?.name ?? "",
    modelName: row.model?.name ?? "",
    year: row.year,
    price: Number(row.price),
    currency: row.currency,
    mileageKm: row.mileage_km,
    fuelType: row.fuel_type,
    transmission: row.transmission,
    city: row.city,
    tramerAmount: Number(row.tramer_amount),
    hasHeavyDamage: row.has_heavy_damage,
    paintedPartsCount: row.painted_parts_count,
    changedPartsCount: row.changed_parts_count,
    hlsUrl: video.hls_url,
    thumbnailUrl: video.thumbnail_url,
  };
}

export type VehicleDetails = {
  bodyType: BodyType | null;
  description: string | null;
  photoUrls: string[];
};

// Detay çekmecesi açılınca istenir: akış sorgusunun taşımadığı alanlar (kasa
// tipi, açıklama) ve fotoğraflar. Kapak fotoğrafı (is_primary) başta, gerisi
// display_order sırasıyla gelir.
export async function fetchVehicleDetails(vehicleId: string): Promise<VehicleDetails> {
  const [vehicleResult, photosResult] = await Promise.all([
    supabase.from("vehicles").select("body_type, description").eq("id", vehicleId).maybeSingle(),
    supabase
      .from("vehicle_images")
      .select("image_url")
      .eq("vehicle_id", vehicleId)
      .order("is_primary", { ascending: false })
      .order("display_order", { ascending: true }),
  ]);

  if (vehicleResult.error) throw vehicleResult.error;
  if (photosResult.error) throw photosResult.error;

  const row = vehicleResult.data as { body_type: BodyType | null; description: string | null } | null;
  const photos = (photosResult.data ?? []) as { image_url: string | null }[];

  return {
    bodyType: row?.body_type ?? null,
    description: row?.description?.trim() || null,
    photoUrls: photos.map((p) => p.image_url).filter((url): url is string => Boolean(url)),
  };
}

// Satıcının numarası feed'de taşınmaz; sadece butona basıldığında
// get_seller_whatsapp RPC'si ile alınır (bkz. 002_seller_contact_rpc.sql).
// Numara yoksa ya da ilan artık aktif değilse null döner.
/** WhatsApp bağlantısı ve hazır mesaj için gereken alanlar */
export type SellerContactVehicle = Pick<FeedVehicle, "id" | "year" | "brandName" | "modelName">;

export async function getSellerWhatsAppUrl(vehicle: SellerContactVehicle): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_seller_whatsapp", {
    p_vehicle_id: vehicle.id,
  });

  if (error) throw error;

  const number = typeof data === "string" ? toWhatsAppNumber(data) : null;
  if (!number) return null;

  const message = `Merhaba, gözüyle'deki ${vehicle.year} ${vehicle.brandName} ${vehicle.modelName} ilanınızla ilgileniyorum.`;

  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

// wa.me, numarayı başında + olmadan uluslararası formatta ister: 905321234567
function toWhatsAppNumber(raw: string): string | null {
  return normalizeTurkishPhone(raw);
}