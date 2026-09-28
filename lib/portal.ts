import {
  fetchFeedPage,
  fetchFeedVehicle,
  type FeedCursor,
  type FeedVehicle,
  type FuelType,
  type TransmissionType,
} from "./feed";
import { isEditableTarget } from "./feed-navigation";
import {
  FILTER_PARAM_KEYS,
  FUEL_TYPES,
  MIN_SEARCH_YEAR,
  TRANSMISSIONS,
  filtersFromSearchParams,
  filtersToSearchParams,
  normalizeTr,
  parsePrice,
  parseYear,
  searchVehicles,
  type Catalog,
  type RawSearchParams,
  type SearchFilters,
  type VehicleSearchResult,
} from "./search";
import { supabase } from "./supabase";

// Ana sayfanın filtreli görünümleri: masaüstü vitrin (1024 px ve üstü: filtre
// konsolu, 9:16 kart ızgarası, Shorts oynatıcısı) ve mobildeki filtreli video
// akışı. İkisi de aynı URL'i okur: ana sayfa /search ile aynı Türkçe
// parametreleri kullanır (/?marka=bmw&minFiyat=500000), paylaşılan bağlantı
// masaüstünde vitrini, telefonda filtreli akışı açar. UI'dan bağımsız.

export type PortalVehicle = {
  id: string;
  /** Satıcının kullanıcı kimliği: pencerede satıcı kartı, takip ve mesaj için */
  sellerId: string | null;
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
  commentsCount: number;
  /** Oynatılabilir HLS adresi; yoksa null (kartta ve pencerede yalnızca kapak) */
  hlsUrl: string | null;
  /** Dikey kart kapağı: videonun karesi (9:16), yoksa ilk fotoğraf */
  posterUrl: string | null;
  /** İlanın kapak fotoğrafı (görselli ilanlar ızgarası); fotoğrafsız ilanda null */
  photoUrl: string | null;
  /** Deneme ilanı (vehicles.is_test): "Test ilanı" etiketiyle görünür */
  isTest: boolean;
  /** vehicles.views_count: kartta, akışta ve oynatıcıda izlenme rozeti (yoksa 0) */
  viewsCount?: number;
  /** İlanın eklenme zamanı (kartta "Bugün", "3 gün önce"…) */
  createdAt: string | null;
};

export type PortalPage<C> = {
  items: PortalVehicle[];
  /** Sonraki sayfanın imleci (arama: offset, takip akışı: zaman + id) */
  next: C;
  hasMore: boolean;
};

export const PORTAL_PAGE_SIZE = 20;

// ---------------------------------------------------------------
// Dönüşümler
// ---------------------------------------------------------------

type ListingMeta = { sellerId: string | null; commentsCount: number; isTest: boolean };

export function portalVehicleFromSearch(row: VehicleSearchResult, meta?: ListingMeta): PortalVehicle {
  return {
    id: row.id,
    sellerId: meta?.sellerId ?? null,
    brandName: row.brandName,
    modelName: row.modelName,
    year: row.year,
    price: row.price,
    currency: row.currency,
    mileageKm: row.mileageKm,
    fuelType: row.fuelType,
    transmission: row.transmission,
    city: row.city,
    tramerAmount: row.tramerAmount,
    hasHeavyDamage: row.hasHeavyDamage,
    paintedPartsCount: row.paintedPartsCount,
    changedPartsCount: row.changedPartsCount,
    commentsCount: meta?.commentsCount ?? 0,
    hlsUrl: row.hasPlayableVideo ? row.videoHlsUrl : null,
    // Fotoğraflar çoğunlukla yatay (4:3); dikey kartta videonun karesi doğru kadrajdır
    posterUrl: row.hasPlayableVideo
      ? (row.videoThumbnailUrl ?? row.coverImageUrl)
      : (row.coverImageUrl ?? row.videoThumbnailUrl),
    photoUrl: row.coverImageUrl,
    isTest: meta?.isTest ?? false,
    viewsCount: row.viewsCount ?? 0,
    createdAt: row.createdAt,
  };
}

export function portalVehicleFromFeed(vehicle: FeedVehicle): PortalVehicle {
  return {
    id: vehicle.id,
    sellerId: vehicle.sellerId,
    brandName: vehicle.brandName,
    modelName: vehicle.modelName,
    year: vehicle.year,
    price: vehicle.price,
    currency: vehicle.currency,
    mileageKm: vehicle.mileageKm,
    fuelType: vehicle.fuelType,
    transmission: vehicle.transmission,
    city: vehicle.city,
    tramerAmount: vehicle.tramerAmount,
    hasHeavyDamage: vehicle.hasHeavyDamage,
    paintedPartsCount: vehicle.paintedPartsCount,
    changedPartsCount: vehicle.changedPartsCount,
    commentsCount: vehicle.commentsCount,
    hlsUrl: vehicle.hlsUrl,
    posterUrl: vehicle.thumbnailUrl,
    // Akış sorgusu fotoğrafları taşımaz (takip akışı yalnızca video ızgarasında)
    photoUrl: null,
    isTest: vehicle.isTest ?? false,
    viewsCount: vehicle.viewsCount,
    createdAt: vehicle.createdAt ?? null,
  };
}

/** Mobil akış kartı oynatılabilir video ister: videosuz ilan null */
export function feedVehicleFromPortal(vehicle: PortalVehicle): FeedVehicle | null {
  if (!vehicle.hlsUrl) return null;
  return {
    id: vehicle.id,
    sellerId: vehicle.sellerId,
    brandName: vehicle.brandName,
    modelName: vehicle.modelName,
    year: vehicle.year,
    price: vehicle.price,
    currency: vehicle.currency,
    mileageKm: vehicle.mileageKm,
    fuelType: vehicle.fuelType,
    transmission: vehicle.transmission,
    city: vehicle.city,
    tramerAmount: vehicle.tramerAmount,
    hasHeavyDamage: vehicle.hasHeavyDamage,
    paintedPartsCount: vehicle.paintedPartsCount,
    changedPartsCount: vehicle.changedPartsCount,
    commentsCount: vehicle.commentsCount,
    hlsUrl: vehicle.hlsUrl,
    thumbnailUrl: vehicle.posterUrl,
    isTest: vehicle.isTest,
    ...(vehicle.viewsCount !== undefined ? { viewsCount: vehicle.viewsCount } : {}),
    ...(vehicle.createdAt ? { createdAt: vehicle.createdAt } : {}),
  };
}

// ---------------------------------------------------------------
// Sorgular
// ---------------------------------------------------------------

/**
 * search_vehicles satıcı kimliğini, yorum sayısını ve test işaretini
 * döndürmüyor (RPC'yi değiştirmek migration ister). Sayfanın ilanları için
 * üçü tek istekte vehicles'tan okunur; akış sorgusu da aynı sütunları misafir
 * olarak okuyor.
 */
async function fetchListingMeta(ids: string[]): Promise<Map<string, ListingMeta>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("vehicles").select("id, seller_id, comments_count, is_test").in("id", ids);
  if (error) throw error;

  const rows = (data ?? []) as { id: string; seller_id: string | null; comments_count: number | null; is_test: boolean | null }[];
  return new Map(
    rows.map((row) => [
      row.id,
      { sellerId: row.seller_id ?? null, commentsCount: Math.max(0, Number(row.comments_count ?? 0)), isTest: row.is_test === true },
    ]),
  );
}

/** Vitrin: filtreye uyan ilanların bir sayfası (offset sayfalama, search_vehicles) */
export async function searchPortalPage(
  filters: SearchFilters,
  offset = 0,
  pageSize = PORTAL_PAGE_SIZE,
): Promise<PortalPage<number>> {
  const page = await searchVehicles(filters, offset, pageSize);
  const meta = await fetchListingMeta(page.items.map((item) => item.id));
  return {
    items: page.items.map((row) => portalVehicleFromSearch(row, meta.get(row.id))),
    next: page.nextOffset,
    hasMore: page.hasMore,
  };
}

/** Vitrinin "Takip Edilenler" sekmesi: takip edilen satıcıların videolu ilanları */
export async function fetchFollowingPortalPage(
  cursor: FeedCursor | null,
  pageSize = PORTAL_PAGE_SIZE,
): Promise<PortalPage<FeedCursor | null>> {
  const page = await fetchFeedPage(cursor, pageSize, "following");
  return { items: page.items.map(portalVehicleFromFeed), next: page.nextCursor, hasMore: page.hasMore };
}

/** /?v=<ilan> bağlantısı: masaüstünde pencere bu ilanla açılır. Yayında değilse null. */
export async function fetchPortalVehicle(id: string): Promise<PortalVehicle | null> {
  const vehicle = await fetchFeedVehicle(id);
  return vehicle ? portalVehicleFromFeed(vehicle) : null;
}

/**
 * Mobil akış, filtre uygulanmışsa: aynı arama, yalnızca videolu ilanlar
 * (akış kartı videosuz çizilemez). Sonraki sayfa offset'le istenir.
 */
export async function fetchFilteredFeedPage(
  filters: SearchFilters,
  offset: number,
  pageSize: number,
): Promise<{ items: FeedVehicle[]; nextOffset: number; hasMore: boolean }> {
  const page = await searchPortalPage({ ...filters, videoOnly: true }, offset, pageSize);
  return {
    items: page.items.map(feedVehicleFromPortal).filter((vehicle): vehicle is FeedVehicle => vehicle !== null),
    nextOffset: page.next,
    hasMore: page.hasMore,
  };
}

// ---------------------------------------------------------------
// URL
// ---------------------------------------------------------------

/**
 * İngilizce eş adlar: elle yazılmış ya da dışarıdan paylaşılan bağlantılar
 * (/?brand=BMW&minPrice=500000). Okunurken Türkçe adlara çevrilir; adres
 * çubuğuna her zaman Türkçe (kanonik) biçim yazılır.
 */
export const FILTER_PARAM_ALIASES: Readonly<Record<string, string>> = {
  brand: "marka",
  city: "sehir",
  minPrice: "minFiyat",
  maxPrice: "maxFiyat",
  minYear: "minYil",
  maxYear: "maxYil",
  maxMileage: "maxKm",
  transmission: "vites",
  fuel: "yakit",
  sort: "sirala",
};

/** Ana sayfada akışı belirli bir ilanla açan parametre (/?v=<ilan-id>) */
export const VEHICLE_PARAM = "v";

type ParamSource = URLSearchParams | RawSearchParams;

function readParam(params: ParamSource, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function isFilterKey(key: string): boolean {
  return FILTER_PARAM_KEYS.includes(key) || key in FILTER_PARAM_ALIASES;
}

/** Adreste bir filtre parametresi (Türkçe ya da eş adı) var mı */
export function hasFilterParams(params: ParamSource): boolean {
  const keys = params instanceof URLSearchParams ? [...params.keys()] : Object.keys(params);
  return keys.some(isFilterKey);
}

/** Marka/model URL'de slug ya da ad olarak durur: id'ye çevirmek için katalog gerekir */
export function filterParamsNeedCatalog(params: ParamSource): boolean {
  return ["marka", "model", "brand"].some((key) => Boolean(readParam(params, key)?.trim()));
}

/** "BMW", "bmw", "Mercedes-Benz" → katalogdaki slug; bulunamazsa değer olduğu gibi */
function resolveSlug<T extends { name: string; slug: string }>(value: string, options: readonly T[]): string {
  const trimmed = value.trim();
  if (options.some((option) => option.slug === trimmed)) return trimmed;
  const key = normalizeTr(trimmed).replace(/[^a-z0-9]+/g, "");
  const match = options.find(
    (option) => normalizeTr(option.name).replace(/[^a-z0-9]+/g, "") === key || option.slug.replace(/[^a-z0-9]+/g, "") === key,
  );
  return match?.slug ?? trimmed;
}

/**
 * Adresteki parametreleri filtreye çevirir: eş adlar, marka/model adı
 * (slug yerine), büyük harfli yakıt/vites değerleri de kabul edilir. Geri
 * kalan kurallar (ters aralık, geçersiz yıl, bilinmeyen değer) /search'le aynı.
 */
export function portalFiltersFromParams(params: ParamSource, catalog: Catalog): SearchFilters {
  const raw: Record<string, string> = {};
  for (const key of FILTER_PARAM_KEYS) {
    const value = readParam(params, key);
    if (value !== undefined) raw[key] = value;
  }
  for (const [alias, key] of Object.entries(FILTER_PARAM_ALIASES)) {
    const value = readParam(params, alias);
    if (value !== undefined && raw[key] === undefined) raw[key] = value;
  }

  if (raw.marka) {
    raw.marka = resolveSlug(raw.marka, catalog.brands);
    const brand = catalog.brands.find((b) => b.slug === raw.marka);
    if (brand && raw.model) {
      raw.model = resolveSlug(
        raw.model,
        catalog.models.filter((m) => m.brandId === brand.id),
      );
    }
  }
  for (const key of ["vites", "yakit", "kasa"]) {
    if (raw[key]) raw[key] = raw[key].split(",").map((value) => normalizeTr(value)).join(",");
  }

  return filtersFromSearchParams(raw, catalog);
}

/** Filtrelerin kanonik sorgu metni: listeleri yeniden kurmak için anahtar */
export function filtersKey(filters: SearchFilters, catalog: Catalog): string {
  return filtersToSearchParams(filters, catalog).toString();
}

/**
 * Ana sayfanın yeni adresi: önce filtreler (kanonik Türkçe), sonra filtre
 * olmayan parametreler (ör. feed=following) korunur. vehicleId verilirse
 * ?v= yazılır, null ise kaldırılır, undefined ise olduğu gibi kalır.
 */
export function buildHomeHref(
  current: URLSearchParams,
  filters: SearchFilters,
  catalog: Catalog,
  vehicleId?: string | null,
): string {
  const next = filtersToSearchParams(filters, catalog);
  current.forEach((value, key) => {
    if (isFilterKey(key) || key === VEHICLE_PARAM) return;
    next.append(key, value);
  });
  const vehicle = vehicleId === undefined ? current.get(VEHICLE_PARAM) : vehicleId;
  if (vehicle) next.set(VEHICLE_PARAM, vehicle);
  const query = next.toString();
  return query ? `/?${query}` : "/";
}

// ---------------------------------------------------------------
// Kart ve pencere davranışı
// ---------------------------------------------------------------

/** Fare kartın üstünde bu kadar kalınca önizleme başlar (ızgarada gezinirken her kart video açmasın) */
export const PREVIEW_DELAY_MS = 180;
/** Önizleme videonun ilk bu kadar saniyesini döngüyle oynatır */
export const PREVIEW_LOOP_SECONDS = 6;

/** Önizleme döngüsü: süre dolunca başa */
export function previewLoopTime(currentTime: number): number | null {
  return currentTime >= PREVIEW_LOOP_SECONDS ? 0 : null;
}

type ModalKeyEvent = Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "defaultPrevented" | "target">;

/**
 * Shorts oynatıcısındaki klavye gezinmesi: ↓ sonraki, ↑ önceki ilan. Yazı
 * alanında, seçim kutusunda, tam ekran fotoğrafta (iç pencere), kendi
 * kaydırması olan alanda ("İlan detayı" çekmecesi: data-own-keys) ve
 * değiştirici tuşla 0. PageUp/PageDown çekmecenin kaydırmasına kalır.
 */
export function modalKeyStep(event: ModalKeyEvent): -1 | 0 | 1 {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0;
  if (isEditableTarget(event.target)) return 0;
  const target = event.target as Element | null;
  if (target && typeof target.closest === "function" && target.closest("[role='dialog'][aria-modal='true'], [data-own-keys]")) return 0;
  if (event.key === "ArrowDown") return 1;
  if (event.key === "ArrowUp") return -1;
  return 0;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const listingDate = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
const listingDateWithYear = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric" });

/** Kartta ilanın eklendiği gün: "Bugün", "Dün", "3 gün önce", "12 Eyl", "12 Eyl 2025" (takvim günüyle) */
export function formatListingDate(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(at)) / DAY_MS);
  if (days <= 0) return "Bugün";
  if (days === 1) return "Dün";
  if (days < 7) return `${days} gün önce`;
  return (at.getFullYear() === now.getFullYear() ? listingDate : listingDateWithYear).format(at);
}

// ---------------------------------------------------------------
// Masaüstü filtre konsolu
// ---------------------------------------------------------------

/** Vites / yakıt kutusunda "birden çok değer seçili" (adresten, ör. /search'te dizel + hibrit) */
export const MULTI_OPTION = "__coklu";

/** Konsol alanlarının yazıldığı hâli (sayılar metin: yarım yazılmış yıl da tutulur) */
export type ConsoleDraft = {
  brandId: string;
  modelId: string;
  city: string;
  minPrice: string;
  maxPrice: string;
  minYear: string;
  maxYear: string;
  transmission: string;
  fuel: string;
};

export type ConsoleErrors = { price: string | null; year: string | null };

const numberText = (value: number | null) => (value !== null ? String(value) : "");
const pickOne = (list: readonly string[]) => (list.length === 0 ? "" : list.length === 1 ? list[0] : MULTI_OPTION);

export function consoleDraftFrom(filters: SearchFilters): ConsoleDraft {
  return {
    brandId: filters.brandId ?? "",
    modelId: filters.modelId ?? "",
    city: filters.city ?? "",
    minPrice: numberText(filters.minPrice),
    maxPrice: numberText(filters.maxPrice),
    minYear: numberText(filters.minYear),
    maxYear: numberText(filters.maxYear),
    transmission: pickOne(filters.transmissions),
    fuel: pickOne(filters.fuelTypes),
  };
}

/** Konsoldaki boş alan: hepsi boşsa filtresiz */
export const EMPTY_CONSOLE_DRAFT: ConsoleDraft = {
  brandId: "",
  modelId: "",
  city: "",
  minPrice: "",
  maxPrice: "",
  minYear: "",
  maxYear: "",
  transmission: "",
  fuel: "",
};

/**
 * Taslak → filtreler. Hiçbir alan zorunlu değil: boş alan süzgeç değildir.
 * Konsolda olmayan filtreler (km, kasa, ağır hasar, sadece videolu,
 * sıralama) base'den korunur. Ters fiyat/yıl aralığı ya da aralık dışı yıl
 * hatadır ve o çift base'deki değerinde kalır; yarım yazılmış yıl (ör. "20")
 * henüz süzgeç sayılmaz ama hata da değildir.
 */
export function filtersFromConsoleDraft(
  draft: ConsoleDraft,
  base: SearchFilters,
  now: Date = new Date(),
): { filters: SearchFilters; errors: ConsoleErrors } {
  const minPrice = parsePrice(draft.minPrice);
  const maxPrice = parsePrice(draft.maxPrice);
  const priceError =
    minPrice !== null && maxPrice !== null && minPrice > maxPrice ? "En az fiyat, en çok fiyattan büyük olamaz." : null;

  const complete = (text: string) => text.replace(/\D/g, "").length === 4;
  const minYear = parseYear(draft.minYear, now);
  const maxYear = parseYear(draft.maxYear, now);
  const yearError =
    (complete(draft.minYear) && minYear === null) || (complete(draft.maxYear) && maxYear === null)
      ? `Yıl ${MIN_SEARCH_YEAR} ile ${now.getFullYear() + 1} arasında olmalı.`
      : minYear !== null && maxYear !== null && minYear > maxYear
        ? "En eski yıl, en yeni yıldan büyük olamaz."
        : null;

  const transmissions: TransmissionType[] =
    draft.transmission === MULTI_OPTION
      ? base.transmissions
      : (TRANSMISSIONS as readonly string[]).includes(draft.transmission)
        ? [draft.transmission as TransmissionType]
        : [];
  const fuelTypes: FuelType[] =
    draft.fuel === MULTI_OPTION
      ? base.fuelTypes
      : (FUEL_TYPES as readonly string[]).includes(draft.fuel)
        ? [draft.fuel as FuelType]
        : [];

  return {
    filters: {
      ...base,
      brandId: draft.brandId || null,
      modelId: draft.brandId && draft.modelId ? draft.modelId : null,
      city: draft.city.trim() || null,
      minPrice: priceError ? base.minPrice : minPrice,
      maxPrice: priceError ? base.maxPrice : maxPrice,
      minYear: yearError ? base.minYear : minYear,
      maxYear: yearError ? base.maxYear : maxYear,
      transmissions,
      fuelTypes,
    },
    errors: { price: priceError, year: yearError },
  };
}

/** İki filtre aynı sonucu mu verir (liste sırası ve alan sırası sabit) */
export function filtersEqual(a: SearchFilters, b: SearchFilters): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
