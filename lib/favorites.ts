import { isUuid } from "./feed";
import { toMyListing, type MyListingRow } from "./my-listings";
import type { VehicleCardData } from "./search";
import { supabase } from "./supabase";

// Favoriler (izleme listesi). UI'dan bağımsız: React Native da kullanabilir.
//
// Giriş yapmamış kullanıcının favorileri bu cihazda (localStorage) tutulur.
// Giriş yapınca hesaba yüklenir: veritabanında ayrı bir tablo yok, şemanın
// kendi "kaydetme" kaydı kullanılır (interactions, type = 'save'). O tabloda
// kullanıcı sadece kendi satırlarını görür/ekler/siler (RLS), (user_id,
// vehicle_id, type) tekildir ve bir tetikleyici vehicles.saves_count'u günceller.

export const FAVORITES_STORAGE_KEY = "elan:favorites:v1";

/** Cihazda tutulan liste için üst sınır: localStorage şişmesin, sorgu URL'si uzamasın */
export const MAX_LOCAL_FAVORITES = 200;

// ---------------------------------------------------------------
// Cihazdaki liste (localStorage)
// ---------------------------------------------------------------

/**
 * localStorage'daki değeri okur. Bozuk JSON, geçersiz id ve tekrarlar
 * sessizce atılır: elle değiştirilmiş ya da eski biçimli veri uygulamayı
 * bozmasın. Sıra korunur (en son eklenen başta).
 */
export function parseStoredFavorites(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return uniqueIds(parsed.filter(isUuid)).slice(0, MAX_LOCAL_FAVORITES);
}

export function serializeFavorites(ids: readonly string[]): string {
  return JSON.stringify(ids.slice(0, MAX_LOCAL_FAVORITES));
}

/** Ekleme listenin başına yapılır: favoriler sayfası en son ekleneni önce gösterir. */
export function withFavorite(ids: readonly string[], vehicleId: string): string[] {
  return [vehicleId, ...ids.filter((id) => id !== vehicleId)];
}

export function withoutFavorites(ids: readonly string[], vehicleIds: Iterable<string>): string[] {
  const drop = new Set(vehicleIds);
  return ids.filter((id) => !drop.has(id));
}

export function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

// ---------------------------------------------------------------
// Hesaptaki liste (Supabase)
// ---------------------------------------------------------------

/** "missing": ilan artık yok (silinmiş); favoriye eklenemez */
export type RemoteAddResult = "added" | "missing";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

export async function fetchRemoteFavoriteIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("interactions")
    .select("vehicle_id")
    .eq("user_id", userId)
    .eq("type", "save")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return uniqueIds(((data ?? []) as { vehicle_id: string }[]).map((row) => row.vehicle_id));
}

export async function addRemoteFavorite(userId: string, vehicleId: string): Promise<RemoteAddResult> {
  const { error } = await supabase
    .from("interactions")
    .insert({ user_id: userId, vehicle_id: vehicleId, type: "save" });

  if (!error) return "added";
  // Zaten favoride (başka sekme/cihaz eklemiş): istenen sonuç bu
  if (error.code === UNIQUE_VIOLATION) return "added";
  if (error.code === FOREIGN_KEY_VIOLATION) return "missing";
  throw error;
}

export async function removeRemoteFavorite(userId: string, vehicleId: string): Promise<void> {
  const { error } = await supabase
    .from("interactions")
    .delete()
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .eq("type", "save");

  if (error) throw error;
}

// ---------------------------------------------------------------
// Favoriler sayfasının kartları
// ---------------------------------------------------------------

// Uzun "in (...)" listeleri istek URL'sini şişirmesin
const CARD_QUERY_CHUNK = 50;

export function toFavoriteCard(row: MyListingRow): VehicleCardData {
  // Kapak ve oynatılabilir video seçimi Vitrinim'deki kurallarla aynı
  const listing = toMyListing(row);
  return {
    id: row.id,
    brandName: row.brand?.name ?? "",
    modelName: row.model?.name ?? "",
    year: row.year,
    price: listing.price,
    currency: row.currency,
    mileageKm: row.mileage_km,
    city: row.city,
    coverImageUrl: listing.coverUrl,
    videoThumbnailUrl: null,
    hasPlayableVideo: listing.hasPlayableVideo,
  };
}

/**
 * Favorideki ilanların kart verisi, verilen id sırasıyla. Sadece yayındaki
 * ilanlar döner: satılmış, kaldırılmış ya da silinmiş ilanlar listede yer almaz
 * (çağıran taraf bunları "artık yayında değil" diye ayırabilir).
 */
export async function fetchFavoriteVehicles(ids: readonly string[]): Promise<VehicleCardData[]> {
  const valid = uniqueIds(ids.filter(isUuid));
  const byId = new Map<string, VehicleCardData>();

  for (let start = 0; start < valid.length; start += CARD_QUERY_CHUNK) {
    const chunk = valid.slice(start, start + CARD_QUERY_CHUNK);
    const { data, error } = await supabase
      .from("vehicles")
      .select(
        `id, status, year, price, currency, mileage_km, city, created_at,
         brand:brands(name),
         model:models(name),
         images:vehicle_images(image_url, is_primary, display_order),
         videos(status, hls_url, thumbnail_url)`,
      )
      .in("id", chunk)
      // RLS satıcıya kendi pasif ilanlarını da gösterir; favoride sadece yayındakiler
      .eq("status", "active");

    if (error) throw error;
    for (const row of (data ?? []) as unknown as MyListingRow[]) {
      byId.set(row.id, toFavoriteCard(row));
    }
  }

  return valid.flatMap((id) => byId.get(id) ?? []);
}
