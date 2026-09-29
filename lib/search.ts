import { supabase } from "./supabase";
import type { FuelType, TransmissionType } from "./feed";
import { BODY_TYPE_LABELS, FUEL_LABELS, TRANSMISSION_LABELS } from "./vehicle-labels";

// UI'dan bağımsız: React Native uygulaması da aynı tipleri ve sorguyu kullanabilir.

// ---------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------

export type BodyType =
  | "sedan"
  | "hatchback"
  | "suv"
  | "crossover"
  | "coupe"
  | "cabrio"
  | "station_wagon"
  | "pickup"
  | "minivan";

export type VideoStatus = "pending" | "processing" | "ready" | "failed";

export type SortOrder = "newest" | "price_asc" | "price_desc" | "mileage_asc";

export const SORT_LABELS: Record<SortOrder, string> = {
  newest: "En yeni",
  price_asc: "Fiyat: düşükten yükseğe",
  price_desc: "Fiyat: yüksekten düşüğe",
  mileage_asc: "Kilometre: düşükten yükseğe",
};

/**
 * Arama filtreleri. null / boş liste = filtre uygulanmıyor. Marka/model
 * id'leri RPC'ye gider. Listelerde (yakıt, vites, kasa) seçeneklerden
 * herhangi biri eşleşirse ilan gelir.
 */
export type SearchFilters = {
  brandId: string | null;
  modelId: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  city: string | null;
  videoOnly: boolean;
  minYear: number | null;
  maxYear: number | null;
  maxMileage: number | null;
  fuelTypes: FuelType[];
  transmissions: TransmissionType[];
  bodyTypes: BodyType[];
  hideHeavyDamage: boolean;
  /** Filtre sayılmaz: sonuçların sırası */
  sort: SortOrder;
};

export const EMPTY_FILTERS: SearchFilters = {
  brandId: null,
  modelId: null,
  minPrice: null,
  maxPrice: null,
  city: null,
  videoOnly: false,
  minYear: null,
  maxYear: null,
  maxMileage: null,
  fuelTypes: [],
  transmissions: [],
  bodyTypes: [],
  hideHeavyDamage: false,
  sort: "newest",
};

export const FUEL_TYPES = Object.keys(FUEL_LABELS) as FuelType[];
export const TRANSMISSIONS = Object.keys(TRANSMISSION_LABELS) as TransmissionType[];
export const BODY_TYPES = Object.keys(BODY_TYPE_LABELS) as BodyType[];

/** Arama listesindeki bir ilan (search_vehicles satırının camelCase hâli). */
export type VehicleSearchResult = {
  id: string;
  brandId: string;
  brandName: string;
  modelId: string;
  modelName: string;
  year: number;
  price: number;
  currency: string;
  mileageKm: number;
  fuelType: FuelType;
  transmission: TransmissionType;
  bodyType: BodyType;
  color: string | null;
  city: string | null;
  tramerAmount: number;
  hasHeavyDamage: boolean;
  paintedPartsCount: number;
  changedPartsCount: number;
  likesCount: number;
  viewsCount: number;
  savesCount: number;
  createdAt: string;
  coverImageUrl: string | null;
  videoHlsUrl: string | null;
  videoThumbnailUrl: string | null;
  videoStatus: VideoStatus | null;
  /** Video işlenmiş ve oynatılabilir: kartta "Video" rozeti görünür */
  hasPlayableVideo: boolean;
};

/** Grid kartının (arama sonuçları, favoriler) ihtiyaç duyduğu alanlar. */
export type VehicleCardData = Pick<
  VehicleSearchResult,
  | "id"
  | "brandName"
  | "modelName"
  | "year"
  | "price"
  | "currency"
  | "mileageKm"
  | "city"
  | "coverImageUrl"
  | "videoThumbnailUrl"
  | "hasPlayableVideo"
> & {
  /** Kasa tipi (arama sonucunda var, favori kartında yok): ilanın /ilan/… adresinde */
  bodyType?: BodyType | null;
};

export type SearchPage = {
  items: VehicleSearchResult[];
  /** Sonraki "daha fazla" isteğinin offset'i */
  nextOffset: number;
  hasMore: boolean;
};

export type BrandOption = { id: string; name: string; slug: string };
export type ModelOption = { id: string; brandId: string; name: string; slug: string };
export type Catalog = { brands: BrandOption[]; models: ModelOption[] };

// search_vehicles RPC'sinin imzası ve dönüş satırı. p_min_year'dan p_sort'a
// kadarki parametreler, 003'teki sürümü genişleten migration ile eklendi.
type SearchVehiclesArgs = {
  p_brand_id: string | null;
  p_model_id: string | null;
  p_min_price: number | null;
  p_max_price: number | null;
  p_city: string | null;
  p_has_video_only: boolean;
  p_min_year: number | null;
  p_max_year: number | null;
  p_max_mileage: number | null;
  p_fuel_types: FuelType[] | null;
  p_transmissions: TransmissionType[] | null;
  p_body_types: BodyType[] | null;
  p_hide_heavy_damage: boolean;
  p_sort: SortOrder;
  p_limit: number;
  p_offset: number;
};

type SearchVehiclesRow = {
  id: string;
  brand_id: string;
  brand_name: string;
  model_id: string;
  model_name: string;
  year: number;
  price: number | string;
  currency: string;
  mileage_km: number;
  fuel_type: FuelType;
  transmission: TransmissionType;
  body_type: BodyType;
  color: string | null;
  city: string | null;
  tramer_amount: number | string;
  has_heavy_damage: boolean;
  painted_parts_count: number;
  changed_parts_count: number;
  likes_count: number;
  views_count: number;
  saves_count: number;
  created_at: string;
  cover_image_url: string | null;
  video_hls_url: string | null;
  video_thumbnail_url: string | null;
  video_status: VideoStatus | null;
};

// ---------------------------------------------------------------
// Arama
// ---------------------------------------------------------------

export const SEARCH_PAGE_SIZE = 20;
// 003'teki search_vehicles, p_limit'i en fazla 50'ye sabitler
const RPC_MAX_LIMIT = 50;

export async function searchVehicles(
  filters: SearchFilters,
  offset = 0,
  pageSize = SEARCH_PAGE_SIZE,
): Promise<SearchPage> {
  const size = Math.max(1, Math.min(pageSize, RPC_MAX_LIMIT - 1));

  // Bir fazlasını isteyip "daha var mı" bilgisini ek istek atmadan öğreniyoruz
  const args: SearchVehiclesArgs = {
    p_brand_id: filters.brandId,
    p_model_id: filters.modelId,
    p_min_price: filters.minPrice,
    p_max_price: filters.maxPrice,
    p_city: filters.city,
    p_has_video_only: filters.videoOnly,
    p_min_year: filters.minYear,
    p_max_year: filters.maxYear,
    p_max_mileage: filters.maxMileage,
    // Boş liste "filtre yok" demek; SQL tarafında null ile ayırt etmek daha basit
    p_fuel_types: filters.fuelTypes.length > 0 ? filters.fuelTypes : null,
    p_transmissions: filters.transmissions.length > 0 ? filters.transmissions : null,
    p_body_types: filters.bodyTypes.length > 0 ? filters.bodyTypes : null,
    p_hide_heavy_damage: filters.hideHeavyDamage,
    p_sort: filters.sort,
    p_limit: size + 1,
    p_offset: Math.max(0, offset),
  };

  const { data, error } = await supabase.rpc("search_vehicles", args);
  if (error) throw error;

  const rows = (data ?? []) as SearchVehiclesRow[];
  const pageRows = rows.slice(0, size);

  return {
    items: pageRows.map(toSearchResult),
    nextOffset: args.p_offset + pageRows.length,
    hasMore: rows.length > size,
  };
}

function toSearchResult(row: SearchVehiclesRow): VehicleSearchResult {
  return {
    id: row.id,
    brandId: row.brand_id,
    brandName: row.brand_name,
    modelId: row.model_id,
    modelName: row.model_name,
    year: row.year,
    price: Number(row.price),
    currency: row.currency,
    mileageKm: row.mileage_km,
    fuelType: row.fuel_type,
    transmission: row.transmission,
    bodyType: row.body_type,
    color: row.color,
    city: row.city,
    tramerAmount: Number(row.tramer_amount),
    hasHeavyDamage: row.has_heavy_damage,
    paintedPartsCount: row.painted_parts_count,
    changedPartsCount: row.changed_parts_count,
    likesCount: row.likes_count,
    viewsCount: row.views_count,
    savesCount: row.saves_count,
    createdAt: row.created_at,
    coverImageUrl: row.cover_image_url,
    videoHlsUrl: row.video_hls_url,
    videoThumbnailUrl: row.video_thumbnail_url,
    videoStatus: row.video_status,
    hasPlayableVideo: row.video_status === "ready" && Boolean(row.video_hls_url),
  };
}

// ---------------------------------------------------------------
// Marka / model kataloğu (filtre alanları ve hızlı arama için)
// ---------------------------------------------------------------

// Supabase varsayılan olarak tek istekte en fazla 1000 satır döndürür;
// model sayısı bunu aşabileceği için boş parça gelene kadar sayfalıyoruz.
const CATALOG_CHUNK = 1000;

/**
 * Marka/model adlarını Türkçe alfabeye ve sayısal değere göre karşılaştırır:
 * "208" < "2008", "3" < "10" (düz metin sıralamasında tersi olurdu).
 * Büyük/küçük harf farkı sırayı etkilemez (Türkçe kuralıyla: I'nın küçüğü ı).
 */
export const compareCatalogNames = new Intl.Collator("tr", { numeric: true, sensitivity: "base" }).compare;

async function fetchAllRows<T>(table: "brands" | "models", columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += CATALOG_CHUNK) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      // Kullanıcıların /sell'de yazdığı adlar ortak listeye (filtreler, seçim kutusu) girmez;
      // ilanın kendisinde adıyla görünür (bkz. *_user_catalog_entries.sql)
      .eq("is_user_created", false)
      .order("id")
      .range(from, from + CATALOG_CHUNK - 1);

    if (error) throw error;
    const chunk = (data ?? []) as unknown as T[];
    rows.push(...chunk);
    // Eksik parça son parçadır: boş bir parça için ayrıca istek atılmaz
    if (chunk.length < CATALOG_CHUNK) return rows;
  }
}

/** Önbellekteki katalog bu kadar süre kullanılır (yeni marka/model en geç bu sürede görünür) */
export const CATALOG_TTL_MS = 10 * 60 * 1000;

let catalogCache: { promise: Promise<Catalog>; at: number } | null = null;

/**
 * Katalog (36 marka, ~300 model) nadiren değişir ve her /search açılışında
 * sunucuda iki sorguyla yeniden okunuyordu: "Ara"ya geçiş 1–1,5 sn bekliyordu.
 * Modül düzeyinde önbellek: sunucuda örnek başına, tarayıcıda sayfa ömrü
 * boyunca. Aynı anda gelen istekler tek sorguyu paylaşır; hata önbelleğe
 * alınmaz (sonraki istek yeniden dener).
 */
export function fetchCatalogCached(now: number = Date.now()): Promise<Catalog> {
  if (catalogCache && now - catalogCache.at < CATALOG_TTL_MS) return catalogCache.promise;
  const entry = { promise: fetchCatalog(), at: now };
  catalogCache = entry;
  entry.promise.catch(() => {
    if (catalogCache === entry) catalogCache = null;
  });
  return entry.promise;
}

/** Testler için */
export function clearCatalogCache() {
  catalogCache = null;
}

export async function fetchCatalog(): Promise<Catalog> {
  const [brandRows, modelRows] = await Promise.all([
    fetchAllRows<{ id: string; name: string; slug: string }>("brands", "id, name, slug"),
    fetchAllRows<{ id: string; brand_id: string; name: string; slug: string }>(
      "models",
      "id, brand_id, name, slug",
    ),
  ]);

  return {
    brands: brandRows.sort((a, b) => compareCatalogNames(a.name, b.name)),
    models: modelRows
      .map((m) => ({ id: m.id, brandId: m.brand_id, name: m.name, slug: m.slug }))
      .sort((a, b) => compareCatalogNames(a.name, b.name)),
  };
}

// ---------------------------------------------------------------
// URL <-> filtre dönüşümü
// Adres çubuğunda okunabilir ve paylaşılabilir parametreler:
//   /search?marka=volkswagen&model=passat&minFiyat=500000&maxFiyat=1000000&sehir=İstanbul&video=1
//     &minYil=2015&maxYil=2020&maxKm=150000&yakit=dizel,hibrit&vites=otomatik&kasa=suv
//     &hasarsiz=1&sirala=fiyat-artan
// ---------------------------------------------------------------

export type RawSearchParams = Record<string, string | string[] | undefined>;

const PARAM = {
  brand: "marka",
  model: "model",
  minPrice: "minFiyat",
  maxPrice: "maxFiyat",
  city: "sehir",
  videoOnly: "video",
  minYear: "minYil",
  maxYear: "maxYil",
  maxMileage: "maxKm",
  fuelTypes: "yakit",
  transmissions: "vites",
  bodyTypes: "kasa",
  hideHeavyDamage: "hasarsiz",
  sort: "sirala",
} as const;

/** Filtrelerin URL'de kullandığı bütün parametre adları (ana sayfa bağlantısını kurarken ayıklanır) */
export const FILTER_PARAM_KEYS: readonly string[] = Object.values(PARAM);

// Varsayılan sıra (en yeni) URL'e yazılmaz
const SORT_SLUGS: Record<Exclude<SortOrder, "newest">, string> = {
  price_asc: "fiyat-artan",
  price_desc: "fiyat-azalan",
  mileage_asc: "km-artan",
};

export const MIN_SEARCH_YEAR = 1970;

/** FeedHeader'daki hızlı arama butonu bu parametreyle gelir: arama kutusu odaklanır */
export const FOCUS_PARAM = "odak";

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** "1.250.000", "1250000 TL" gibi girdilerden tam sayı çıkarır. */
export function parsePrice(value: string | null | undefined): number | null {
  const digits = (value ?? "").replace(/\D/g, "").slice(0, 12);
  return digits ? Number(digits) : null;
}

/** Dört haneli ve makul aralıktaki (1970 – gelecek yıl) model yılı, yoksa null. */
export function parseYear(value: string | null | undefined, now: Date = new Date()): number | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length !== 4) return null;
  const year = Number(digits);
  return year >= MIN_SEARCH_YEAR && year <= now.getFullYear() + 1 ? year : null;
}

/** "dizel,hibrit" → izin verilen değerler, tekrarsız ve seçenek sırasıyla. */
function parseList<T extends string>(value: string | undefined, allowed: readonly T[]): T[] {
  const picked = new Set((value ?? "").split(",").map((v) => v.trim()));
  return allowed.filter((option) => picked.has(option));
}

function parseSort(value: string | undefined): SortOrder {
  const match = (Object.entries(SORT_SLUGS) as [SortOrder, string][]).find(([, slug]) => slug === value);
  return match?.[0] ?? "newest";
}

export function filtersFromSearchParams(params: RawSearchParams, catalog: Catalog): SearchFilters {
  const brandSlug = firstValue(params[PARAM.brand]);
  const modelSlug = firstValue(params[PARAM.model]);

  const brand = brandSlug ? catalog.brands.find((b) => b.slug === brandSlug) : undefined;
  const model =
    brand && modelSlug
      ? catalog.models.find((m) => m.brandId === brand.id && m.slug === modelSlug)
      : undefined;

  let minPrice = parsePrice(firstValue(params[PARAM.minPrice]));
  let maxPrice = parsePrice(firstValue(params[PARAM.maxPrice]));
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }

  // "istanbul" → "İstanbul": 81 ilden biriyle eşleşirse yazımı düzeltilir
  const rawCity = firstValue(params[PARAM.city])?.trim().slice(0, 60) || null;
  const city = rawCity
    ? (TURKISH_CITIES.find((c) => normalizeTr(c) === normalizeTr(rawCity)) ?? rawCity)
    : null;

  let minYear = parseYear(firstValue(params[PARAM.minYear]));
  let maxYear = parseYear(firstValue(params[PARAM.maxYear]));
  if (minYear !== null && maxYear !== null && minYear > maxYear) {
    [minYear, maxYear] = [maxYear, minYear];
  }

  return {
    brandId: brand?.id ?? null,
    modelId: model?.id ?? null,
    minPrice,
    maxPrice,
    city,
    videoOnly: firstValue(params[PARAM.videoOnly]) === "1",
    minYear,
    maxYear,
    maxMileage: parsePrice(firstValue(params[PARAM.maxMileage])),
    fuelTypes: parseList(firstValue(params[PARAM.fuelTypes]), FUEL_TYPES),
    transmissions: parseList(firstValue(params[PARAM.transmissions]), TRANSMISSIONS),
    bodyTypes: parseList(firstValue(params[PARAM.bodyTypes]), BODY_TYPES),
    hideHeavyDamage: firstValue(params[PARAM.hideHeavyDamage]) === "1",
    sort: parseSort(firstValue(params[PARAM.sort])),
  };
}

export function filtersToSearchParams(filters: SearchFilters, catalog: Catalog): URLSearchParams {
  const params = new URLSearchParams();
  const model = catalog.models.find((m) => m.id === filters.modelId);
  const brand = catalog.brands.find((b) => b.id === (filters.brandId ?? model?.brandId));

  if (brand) params.set(PARAM.brand, brand.slug);
  if (brand && model && model.brandId === brand.id) params.set(PARAM.model, model.slug);
  if (filters.minPrice !== null) params.set(PARAM.minPrice, String(filters.minPrice));
  if (filters.maxPrice !== null) params.set(PARAM.maxPrice, String(filters.maxPrice));
  if (filters.city) params.set(PARAM.city, filters.city);
  if (filters.videoOnly) params.set(PARAM.videoOnly, "1");
  if (filters.minYear !== null) params.set(PARAM.minYear, String(filters.minYear));
  if (filters.maxYear !== null) params.set(PARAM.maxYear, String(filters.maxYear));
  if (filters.maxMileage !== null) params.set(PARAM.maxMileage, String(filters.maxMileage));
  if (filters.fuelTypes.length > 0) params.set(PARAM.fuelTypes, filters.fuelTypes.join(","));
  if (filters.transmissions.length > 0) params.set(PARAM.transmissions, filters.transmissions.join(","));
  if (filters.bodyTypes.length > 0) params.set(PARAM.bodyTypes, filters.bodyTypes.join(","));
  if (filters.hideHeavyDamage) params.set(PARAM.hideHeavyDamage, "1");
  if (filters.sort !== "newest") params.set(PARAM.sort, SORT_SLUGS[filters.sort]);

  return params;
}

/** Filtre rozetindeki sayı. Sıralama filtre sayılmaz. */
export function countActiveFilters(filters: SearchFilters): number {
  return (
    (filters.brandId ? 1 : 0) +
    (filters.modelId ? 1 : 0) +
    (filters.minPrice !== null || filters.maxPrice !== null ? 1 : 0) +
    (filters.city ? 1 : 0) +
    (filters.videoOnly ? 1 : 0) +
    (filters.minYear !== null || filters.maxYear !== null ? 1 : 0) +
    (filters.maxMileage !== null ? 1 : 0) +
    (filters.fuelTypes.length > 0 ? 1 : 0) +
    (filters.transmissions.length > 0 ? 1 : 0) +
    (filters.bodyTypes.length > 0 ? 1 : 0) +
    (filters.hideHeavyDamage ? 1 : 0)
  );
}

// ---------------------------------------------------------------
// Biçimlendirme ve Türkçe metin yardımcıları
// ---------------------------------------------------------------

const amountFormatter = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

export function formatAmount(value: number): string {
  return amountFormatter.format(value);
}

const CURRENCIES: Record<string, { symbol: string; spoken: string }> = {
  TRY: { symbol: "₺", spoken: "TL" },
  USD: { symbol: "$", spoken: "dolar" },
  EUR: { symbol: "€", spoken: "euro" },
};

export function currencySymbol(code: string): string {
  return CURRENCIES[code]?.symbol ?? code;
}

export function currencySpoken(code: string): string {
  return CURRENCIES[code]?.spoken ?? code;
}

const TR_FOLD: Record<string, string> = {
  ı: "i",
  İ: "i",
  I: "i",
  ş: "s",
  Ş: "s",
  ğ: "g",
  Ğ: "g",
  ü: "u",
  Ü: "u",
  ö: "o",
  Ö: "o",
  ç: "c",
  Ç: "c",
};

/**
 * "İstanbul", "ISTANBUL", "istanbul" → "istanbul"; "Citroën" → "citroen".
 * Veritabanındaki fn_normalize_tr ile aynı mantık (şehir araması sunucuda
 * zaten normalize ediliyor; bu fonksiyon istemcideki marka/model önerileri için).
 */
export function normalizeTr(text: string): string {
  return text
    .replace(/[ıİIşŞğĞüÜöÖçÇ]/g, (ch) => TR_FOLD[ch] ?? ch)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Şehir alanındaki öneriler için 81 il */
// prettier-ignore
export const TURKISH_CITIES: readonly string[] = [
  "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Aksaray", "Amasya", "Ankara", "Antalya",
  "Ardahan", "Artvin", "Aydın", "Balıkesir", "Bartın", "Batman", "Bayburt", "Bilecik",
  "Bingöl", "Bitlis", "Bolu", "Burdur", "Bursa", "Çanakkale", "Çankırı", "Çorum",
  "Denizli", "Diyarbakır", "Düzce", "Edirne", "Elazığ", "Erzincan", "Erzurum", "Eskişehir",
  "Gaziantep", "Giresun", "Gümüşhane", "Hakkari", "Hatay", "Iğdır", "Isparta", "İstanbul",
  "İzmir", "Kahramanmaraş", "Karabük", "Karaman", "Kars", "Kastamonu", "Kayseri", "Kırıkkale",
  "Kırklareli", "Kırşehir", "Kilis", "Kocaeli", "Konya", "Kütahya", "Malatya", "Manisa",
  "Mardin", "Mersin", "Muğla", "Muş", "Nevşehir", "Niğde", "Ordu", "Osmaniye",
  "Rize", "Sakarya", "Samsun", "Siirt", "Sinop", "Sivas", "Şanlıurfa", "Şırnak",
  "Tekirdağ", "Tokat", "Trabzon", "Tunceli", "Uşak", "Van", "Yalova", "Yozgat",
  "Zonguldak",
];