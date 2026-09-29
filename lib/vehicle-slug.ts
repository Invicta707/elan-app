import type { BodyType } from "./search";
import { BODY_TYPE_LABELS } from "./vehicle-labels";

// İlanın okunabilir adresi: /ilan/<yıl>-<marka>-<model>-<kasa>-<il>-<ilan-id>
// Örnek: /ilan/2021-bmw-320i-sedan-izmir-1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed
//
// Sayfa (app/ilan/[slug]) ilanı yalnızca sondaki UUID'den bulur; adresin geri
// kalanı okunurluk ve arama motorları içindir. Slug eksik ya da eskiyse (ör.
// il değişti, bağlantıda kasa tipi yok) sayfa doğru adrese kalıcı yönlendirir.
// Eski /vehicles/<id> adresleri 301 ile buraya gelir (app/vehicles/[id]/route.ts).
// UI'dan bağımsız: testleri lib/vehicle-slug.test.ts'de.

export const LISTING_BASE_PATH = "/ilan";

/** Slug'ın (UUID hariç) en fazla uzunluğu: kullanıcının yazdığı uzun model adları adresi şişirmesin */
export const MAX_SLUG_LENGTH = 80;

export type ListingSlugInput = {
  year: number | null | undefined;
  brandName: string;
  modelName: string;
  /** Bilinmiyorsa (ör. favori kartı) slug'da yer almaz; sayfa tam adrese yönlendirir */
  bodyType?: BodyType | null;
  city?: string | null;
};

export type ListingLinkInput = ListingSlugInput & { id: string };

// Türkçe harfler ASCII karşılığına; kalan aksanlar (é, ë, š…) NFKD ile ayrılıp atılır
const TURKISH_ASCII: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/**
 * "Mercedes-Benz C 200 İzmir" → "mercedes-benz-c-200-izmir". Türkçe küçük harf
 * kuralıyla küçültür (I → ı → i, İ → i), harf ve rakam dışını tek tireye çevirir.
 */
export function slugify(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşüâîû]/g, (char) => TURKISH_ASCII[char] ?? char)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "2021-bmw-320i-sedan-izmir": yıl, marka, model, kasa tipi ve il (boş olanlar atlanır) */
export function vehicleSlug(v: ListingSlugInput): string {
  const parts = [
    v.year ? String(v.year) : "",
    v.brandName,
    v.modelName,
    v.bodyType ? (BODY_TYPE_LABELS[v.bodyType] ?? v.bodyType) : "",
    v.city ?? "",
  ];
  const slug = parts.map(slugify).filter(Boolean).join("-");
  if (slug.length <= MAX_SLUG_LENGTH) return slug;
  // Kelimenin ortasından kesilmesin: sınırdan önceki son tireye kadar
  const cut = slug.slice(0, MAX_SLUG_LENGTH + 1);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > 0 ? cut.slice(0, lastDash) : cut.slice(0, MAX_SLUG_LENGTH)).replace(/-+$/, "");
}

/** Adresin /ilan/ sonrası: "<slug>-<id>" (slug boşsa yalnızca id) */
export function listingSegment(v: ListingLinkInput): string {
  const slug = vehicleSlug(v);
  const id = v.id.toLowerCase();
  return slug ? `${slug}-${id}` : id;
}

/** İlanın tam (canonical) yolu: /ilan/2021-bmw-320i-sedan-izmir-<id> */
export function vehicleListingPath(v: ListingLinkInput): string {
  return `${LISTING_BASE_PATH}/${listingSegment(v)}`;
}

/**
 * Yalnızca kimlik bilinen yerler için (Vitrinim, sohbet, yönetim): /ilan/<id>.
 * Sayfa ilanı okuyup tam adrese kalıcı yönlendirir.
 */
export function vehicleIdPath(id: string): string {
  return `${LISTING_BASE_PATH}/${encodeURIComponent(id)}`;
}

const TRAILING_UUID = /(?:^|-)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * /ilan/[slug] parametresinden ilan kimliği: sondaki UUID. Slug kısmı ne olursa
 * olsun kimlik bulunur (canonical denetimi sayfada). UUID yoksa null.
 */
export function parseListingSegment(segment: string): { id: string; slug: string } | null {
  let value = segment;
  try {
    value = decodeURIComponent(segment);
  } catch {
    // Bozuk yüzde kodlaması: olduğu gibi denenir
  }
  const match = TRAILING_UUID.exec(value);
  if (!match) return null;
  return { id: match[1].toLowerCase(), slug: value.slice(0, match.index) };
}
