import type { FuelType, TransmissionType } from "./feed";
import { normalizeTurkishPhone } from "./phone";
import type { BodyType } from "./search";

// /sell formunun saf (React'ten ve Supabase istemcisinden bağımsız) mantığı:
// doğrulama ve veritabanına yazılacak kayıtların hazırlanması. Testleri
// lib/listing.test.ts'de.

export type DamageStatus = "none" | "heavy";

export type ListingDraft = {
  brandId: string;
  modelId: string;
  year: string;
  mileageKm: string;
  price: string;
  city: string;
  bodyType: BodyType | "";
  fuelType: FuelType | "";
  transmission: TransmissionType | "";
  damageStatus: DamageStatus;
  description: string;
  whatsapp: string;
};

export const EMPTY_LISTING_DRAFT: ListingDraft = {
  brandId: "",
  modelId: "",
  year: "",
  mileageKm: "",
  price: "",
  city: "",
  bodyType: "",
  fuelType: "",
  transmission: "",
  damageStatus: "none",
  description: "",
  whatsapp: "",
};

export const onlyDigits = (value: string) => value.replace(/\D/g, "");

const MIN_YEAR = 1970;

/** İlk hatanın kullanıcıya gösterilecek metnini, form geçerliyse null döner. */
export function validateListingDraft(draft: ListingDraft, now: Date = new Date()): string | null {
  if (!draft.brandId || !draft.modelId) return "Marka ve model seçmelisin.";
  const year = Number(draft.year);
  if (!year || year < MIN_YEAR || year > now.getFullYear() + 1) return "Geçerli bir yıl gir.";
  if (!onlyDigits(draft.mileageKm)) return "Kilometreyi gir.";
  if (!onlyDigits(draft.price)) return "Fiyatı gir.";
  if (!draft.city.trim()) return "Şehir seç ya da yaz.";
  if (!draft.bodyType) return "Kasa tipi seç.";
  if (!draft.fuelType) return "Yakıt türü seç.";
  if (!draft.transmission) return "Vites tipi seç.";
  if (!normalizeTurkishPhone(draft.whatsapp)) return "Geçerli bir WhatsApp numarası gir.";
  return null;
}

export type VehicleInsert = {
  seller_id: string;
  brand_id: string;
  model_id: string;
  year: number;
  mileage_km: number;
  price: number;
  currency: "TRY";
  city: string;
  body_type: BodyType;
  fuel_type: FuelType;
  transmission: TransmissionType;
  has_heavy_damage: boolean;
  description: string | null;
  // Video hazır olunca webhook (ya da yerelde /api/dev/complete-upload) ilanı
  // "active" yapar; fn_check_vehicle_publishable o geçişi denetler.
  status: "pending_video";
};

export type ListingRecords = {
  profile: { id: string; whatsapp_number: string };
  vehicle: VehicleInsert;
};

/**
 * profiles ve vehicles tablolarına yazılacak kayıtlar. Taslak geçersizse
 * validateListingDraft'ın mesajıyla hata fırlatır: taslak, doğrulamadan sonra
 * (ör. giriş penceresi açıkken) değişmiş olsa bile eksik kayıt yazılmaz.
 */
export function buildListingRecords(sellerId: string, draft: ListingDraft): ListingRecords {
  const error = validateListingDraft(draft);
  const whatsappNumber = normalizeTurkishPhone(draft.whatsapp);
  if (error || !whatsappNumber || !draft.bodyType || !draft.fuelType || !draft.transmission) {
    throw new Error(error ?? "İlan bilgileri eksik.");
  }

  return {
    profile: { id: sellerId, whatsapp_number: whatsappNumber },
    vehicle: {
      seller_id: sellerId,
      brand_id: draft.brandId,
      model_id: draft.modelId,
      year: Number(draft.year),
      mileage_km: Number(onlyDigits(draft.mileageKm)),
      price: Number(onlyDigits(draft.price)),
      currency: "TRY",
      city: draft.city.trim(),
      body_type: draft.bodyType,
      fuel_type: draft.fuelType,
      transmission: draft.transmission,
      has_heavy_damage: draft.damageStatus === "heavy",
      description: draft.description.trim() || null,
      status: "pending_video",
    },
  };
}

// ---------------------------------------------------------------
// Fotoğraflar
// ---------------------------------------------------------------

export const PHOTO_BUCKET = "vehicle-photos";

/**
 * Depolama anahtarı: <ilan>/<sıra>.<uzantı>. Dosya adı kullanılmaz; Supabase
 * Storage ASCII dışı karakterli (ş, ğ, ı…) anahtarları "Invalid key" hatasıyla
 * reddeder. Uzantı MIME türünden gelir (dosya adında uzantı olmayabilir).
 */
export function photoStoragePath(vehicleId: string, index: number, mimeType: string): string {
  const extension = mimeType.split("/")[1]?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `${vehicleId}/${index}.${extension}`;
}

export type VehicleImageRow = {
  vehicle_id: string;
  image_url: string;
  display_order: number;
  is_primary: boolean;
};

/** İlk fotoğraf kapak olur: arama sonuçlarında (search_vehicles.cover_image_url) görünür. */
export function buildVehicleImageRow(vehicleId: string, imageUrl: string, index: number): VehicleImageRow {
  return { vehicle_id: vehicleId, image_url: imageUrl, display_order: index, is_primary: index === 0 };
}
