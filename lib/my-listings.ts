import type { VehicleStatus } from "./listing-status";
import { supabase } from "./supabase";

// "Vitrinim": giriş yapan satıcının ilanları ve durum değişikliği.

export type MyListing = {
  id: string;
  title: string;
  year: number;
  price: number;
  currency: string;
  mileageKm: number;
  city: string | null;
  status: VehicleStatus;
  createdAt: string;
  /** Kapak fotoğrafı, yoksa video kapağı */
  coverUrl: string | null;
  /** Vitrin ızgarası (dikey kareler): video kapağı, yoksa kapak fotoğrafı */
  posterUrl: string | null;
  hasPlayableVideo: boolean;
  viewsCount: number;
};

export type MyListingRow = {
  id: string;
  status: VehicleStatus;
  year: number;
  price: number | string;
  currency: string;
  mileage_km: number;
  city: string | null;
  created_at: string;
  views_count?: number | null;
  brand: { name: string } | null;
  model: { name: string } | null;
  images: { image_url: string | null; is_primary: boolean; display_order: number }[] | null;
  videos: { status: string; hls_url: string | null; thumbnail_url: string | null }[] | null;
};

export function toMyListing(row: MyListingRow): MyListing {
  const images = [...(row.images ?? [])]
    .filter((i) => i.image_url)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.display_order - b.display_order);
  const videos = row.videos ?? [];
  const readyVideo = videos.find((v) => v.status === "ready" && v.hls_url);
  const videoPoster = readyVideo?.thumbnail_url ?? videos.find((v) => v.thumbnail_url)?.thumbnail_url ?? null;

  return {
    id: row.id,
    title: `${row.brand?.name ?? ""} ${row.model?.name ?? ""}`.trim(),
    year: row.year,
    price: Number(row.price),
    currency: row.currency,
    mileageKm: row.mileage_km,
    city: row.city,
    status: row.status,
    createdAt: row.created_at,
    coverUrl:
      images[0]?.image_url ??
      readyVideo?.thumbnail_url ??
      videos.find((v) => v.thumbnail_url)?.thumbnail_url ??
      null,
    posterUrl: videoPoster ?? images[0]?.image_url ?? null,
    hasPlayableVideo: Boolean(readyVideo),
    viewsCount: Number(row.views_count ?? 0),
  };
}

export async function fetchMyListings(sellerId: string): Promise<MyListing[]> {
  const { data, error } = await supabase
    .from("vehicles")
    .select(
      `id, status, year, price, currency, mileage_km, city, created_at, views_count,
       brand:brands(name),
       model:models(name),
       images:vehicle_images(image_url, is_primary, display_order),
       videos(status, hls_url, thumbnail_url)`,
    )
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as unknown as MyListingRow[]).map(toMyListing);
}

/** Veritabanı hatasını kullanıcıya gösterilecek metne çevirir. */
export function statusErrorMessage(error: { code?: string; message?: string }): string {
  switch (error.code) {
    // Geçersiz geçiş ya da yayın şartı (fotoğraf/video): mesaj veritabanından, Türkçe
    case "23514":
      return error.message || "Bu ilanın durumu bu şekilde değiştirilemez.";
    case "P0002":
      return "İlan bulunamadı. Sayfayı yenileyip tekrar dene.";
    case "42501":
      return "Bu işlem için giriş yapmalısın.";
    default:
      return "İlan durumu güncellenemedi. Bağlantını kontrol edip tekrar dene.";
  }
}

/** Durumu set_vehicle_status üzerinden değiştirir; sahiplik ve geçiş kuralları orada denetlenir. */
export async function updateListingStatus(vehicleId: string, status: VehicleStatus): Promise<VehicleStatus> {
  const { data, error } = await supabase.rpc("set_vehicle_status", {
    p_vehicle_id: vehicleId,
    p_status: status,
  });
  if (error) throw new Error(statusErrorMessage(error));
  return data as VehicleStatus;
}
