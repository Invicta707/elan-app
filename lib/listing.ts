import { MAX_BRAND_NAME, MAX_MODEL_NAME, catalogNameError, cleanCatalogName } from "./catalog-search";
import type { FuelType, TransmissionType } from "./feed";
import { normalizeTurkishPhone } from "./phone";
import type { BodyType } from "./search";

// /sell formunun saf (React'ten ve Supabase istemcisinden bağımsız) mantığı:
// doğrulama ve veritabanına yazılacak kayıtların hazırlanması. Testleri
// lib/listing.test.ts'de.

export type DamageStatus = "none" | "heavy";

export type ListingDraft = {
  /** Katalogdan seçilen marka; boşsa brandName (kullanıcının yazdığı yeni marka) */
  brandId: string;
  brandName: string;
  /** Katalogdan seçilen model (yalnızca katalogdaki markanın); boşsa modelName */
  modelId: string;
  modelName: string;
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
  brandName: "",
  modelId: "",
  modelName: "",
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

/** Marka: katalogdan seçilmiş ya da geçerli bir ad yazılmış olmalı */
function brandError(draft: ListingDraft): string | null {
  if (draft.brandId) return null;
  if (!cleanCatalogName(draft.brandName)) return "Marka seç ya da yaz.";
  return catalogNameError(draft.brandName, MAX_BRAND_NAME);
}

/** Model: katalogdaki markanın katalog modeli ya da geçerli bir ad */
function modelError(draft: ListingDraft): string | null {
  if (draft.modelId && draft.brandId) return null;
  if (!cleanCatalogName(draft.modelName)) return brandError(draft) ? "Önce marka seç." : "Model seç ya da yaz.";
  return catalogNameError(draft.modelName, MAX_MODEL_NAME);
}

/** İlk hatanın kullanıcıya gösterilecek metnini, form geçerliyse null döner. */
export function validateListingDraft(draft: ListingDraft, now: Date = new Date()): string | null {
  if (brandError(draft) || modelError(draft)) return "Marka ve model seçmelisin.";
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

// ---------------------------------------------------------------
// Adımlı form: alan hataları, adımlar ve sayı biçimi
// ---------------------------------------------------------------

/** Doğrulanan alanlar (hasar durumu ve açıklama her zaman geçerlidir) */
/** Doğrulanan alanlar (hasar durumu ve açıklama her zaman geçerli; yazılan marka/model adı
 * hatası marka/model alanında gösterilir) */
export type ListingField = Exclude<keyof ListingDraft, "damageStatus" | "description" | "brandName" | "modelName">;
export type ListingFieldErrors = Partial<Record<ListingField, string>>;

/**
 * Her alanın kendi hatası; form, mesajı alanın hemen altında gösterir.
 * Kurallar validateListingDraft ile aynıdır (lib/listing.test.ts ikisini
 * karşılaştırır); son kapı yine validateListingDraft / buildListingRecords.
 */
export function listingFieldErrors(draft: ListingDraft, now: Date = new Date()): ListingFieldErrors {
  const errors: ListingFieldErrors = {};
  const maxYear = now.getFullYear() + 1;
  const year = Number(draft.year);

  const brand = brandError(draft);
  if (brand) errors.brandId = brand;
  const model = modelError(draft);
  if (model) errors.modelId = model;
  if (!year || year < MIN_YEAR || year > maxYear) errors.year = `${MIN_YEAR}–${maxYear} arasında bir yıl gir.`;
  if (!onlyDigits(draft.mileageKm)) errors.mileageKm = "Kilometreyi gir.";
  if (!onlyDigits(draft.price)) errors.price = "Fiyatı gir.";
  if (!draft.city.trim()) errors.city = "Şehir seç ya da yaz.";
  if (!draft.bodyType) errors.bodyType = "Kasa tipi seç.";
  if (!draft.fuelType) errors.fuelType = "Yakıt türü seç.";
  if (!draft.transmission) errors.transmission = "Vites tipi seç.";
  if (!normalizeTurkishPhone(draft.whatsapp)) errors.whatsapp = "Geçerli bir WhatsApp numarası gir.";
  return errors;
}

export type ListingStepId = "vehicle" | "media" | "details";

/** İlan verme adımları; doğrulanan her alan tam olarak bir adımda yer alır. */
export const LISTING_STEPS: readonly { id: ListingStepId; title: string; fields: readonly ListingField[] }[] = [
  {
    id: "vehicle",
    title: "Araç Bilgileri",
    fields: ["brandId", "modelId", "year", "mileageKm", "bodyType", "fuelType", "transmission"],
  },
  // Video zorunluluğu dosya seçimine bağlı; formda ayrıca denetlenir
  { id: "media", title: "Medya & Video", fields: [] },
  { id: "details", title: "Fiyat & Detaylar", fields: ["price", "city", "whatsapp"] },
];

/** Hataların yalnızca bu adımdaki alanlara ait olanları */
export function stepFieldErrors(stepIndex: number, errors: ListingFieldErrors): ListingFieldErrors {
  const result: ListingFieldErrors = {};
  for (const field of LISTING_STEPS[stepIndex]?.fields ?? []) {
    if (errors[field]) result[field] = errors[field];
  }
  return result;
}

/** Rakamları binlik ayraçla yazar: "1250000" → "1.250.000" (Number'a çevirmeden, hassasiyet kaybı yok) */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Biçimlenmiş metinde, baştan `digitCount` rakamın hemen sonrasındaki imleç
 * konumu. Kullanıcı ortadan bir rakam silince imleç sona kaçmasın diye.
 */
export function caretAfterDigits(formatted: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    if (/\d/.test(formatted[i]) && ++seen === digitCount) return i + 1;
  }
  return formatted.length;
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

/**
 * Marka ve model: katalogdan seçildiyse id, yeni yazıldıysa ad. İkisi de
 * katalogdansa id'ler doğrudan yazılır; değilse resolve_listing_catalog
 * RPC'si adı bulur ya da kataloğa ekler ve id'leri döner.
 */
export type CatalogSelection = {
  brandId: string | null;
  brandName: string | null;
  modelId: string | null;
  modelName: string | null;
};

export type ListingRecords = {
  profile: { id: string; whatsapp_number: string };
  catalog: CatalogSelection;
  vehicle: Omit<VehicleInsert, "brand_id" | "model_id">;
};

/** Marka ve model katalogdan mı (RPC'ye gerek yok)? */
export function catalogIds(catalog: CatalogSelection): { brand_id: string; model_id: string } | null {
  return catalog.brandId && catalog.modelId ? { brand_id: catalog.brandId, model_id: catalog.modelId } : null;
}

/** resolve_listing_catalog RPC'sinin parametreleri */
export function catalogRpcArgs(catalog: CatalogSelection) {
  return {
    p_brand_id: catalog.brandId,
    p_brand_name: catalog.brandName,
    p_model_id: catalog.modelId,
    p_model_name: catalog.modelName,
  };
}

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
    catalog: {
      brandId: draft.brandId || null,
      brandName: draft.brandId ? null : cleanCatalogName(draft.brandName),
      modelId: draft.brandId && draft.modelId ? draft.modelId : null,
      modelName: draft.brandId && draft.modelId ? null : cleanCatalogName(draft.modelName),
    },
    vehicle: {
      seller_id: sellerId,
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

// Sunucudaki sınırlarla aynı: bucket'ın file_size_limit / allowed_mime_types
// değerleri ve fn_can_upload_vehicle_photo'nun yol kuralı (sıra 0–9, bu
// uzantılar). Bkz. supabase/migrations/*_vehicle_photos_storage_limits.sql;
// lib/storage-rls.test.ts ikisini karşılaştırır.
export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/**
 * HEIC yok: tarayıcıların çoğu gösteremez. iPhone'da Safari, galeriden seçilen
 * HEIC fotoğrafı yüklemeden önce JPEG'e çevirir.
 */
export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Fotoğraf yüklenemeyecekse kullanıcıya gösterilecek neden, uygunsa null. */
export function photoRejection(file: { type: string; size: number }): string | null {
  if (!(PHOTO_MIME_TYPES as readonly string[]).includes(file.type.toLowerCase())) {
    return "Fotoğraflar JPEG, PNG ya da WebP biçiminde olmalı.";
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return `Fotoğraflar en fazla ${MAX_PHOTO_BYTES / (1024 * 1024)} MB olabilir.`;
  }
  return null;
}

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
