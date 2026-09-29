import type { MetadataRoute } from "next";
import type { BodyType } from "./search";
import { supabase } from "./supabase";
import { vehicleListingPath } from "./vehicle-slug";

// app/sitemap.ts'in verisi: yalnızca yayındaki ilanların güncel /ilan/… adresleri
// ve herkese açık sabit sayfalar. Deneme ilanları (is_test) arama motoruna
// verilmez. UI'dan bağımsız: testleri lib/sitemap.test.ts'de.

/** Bir sitemap dosyasının sınırı 50.000 adres; sabit sayfalara yer kalır */
export const MAX_SITEMAP_LISTINGS = 49_000;
/** PostgREST varsayılan satır sınırı (1000) kadar sayfa */
export const SITEMAP_PAGE_SIZE = 1000;

export type SitemapListing = {
  id: string;
  year: number;
  brandName: string;
  modelName: string;
  bodyType: BodyType | null;
  city: string | null;
  updatedAt: string | null;
};

type SitemapRow = {
  id: string;
  year: number;
  body_type: BodyType | null;
  city: string | null;
  updated_at: string | null;
  brand: { name: string } | null;
  model: { name: string } | null;
};

/**
 * Anonim okuma: RLS yalnızca yayındaki (status = 'active', dolayısıyla
 * yönetici onaylı ve videosu işlenmiş) ilanları verir; sorgu yine de
 * durumu açıkça süzer. En son güncellenen önce.
 */
export async function fetchSitemapListings(limit = MAX_SITEMAP_LISTINGS): Promise<SitemapListing[]> {
  const listings: SitemapListing[] = [];
  for (let from = 0; from < limit; from += SITEMAP_PAGE_SIZE) {
    const to = Math.min(from + SITEMAP_PAGE_SIZE, limit) - 1;
    const { data, error } = await supabase
      .from("vehicles")
      .select("id, year, body_type, city, updated_at, brand:brands(name), model:models(name)")
      .eq("status", "active")
      .eq("is_test", false)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (error) throw error;
    const rows = (data ?? []) as unknown as SitemapRow[];
    for (const row of rows) {
      listings.push({
        id: row.id,
        year: row.year,
        brandName: row.brand?.name ?? "",
        modelName: row.model?.name ?? "",
        bodyType: row.body_type,
        city: row.city,
        updatedAt: row.updated_at,
      });
    }
    if (rows.length < to - from + 1) break;
  }
  return listings;
}

/** Arama motoruna açık sabit sayfalar (giriş isteyenler ve yönetim hariç) */
const STATIC_PAGES: { path: string; changeFrequency: "hourly" | "daily" | "yearly"; priority: number }[] = [
  { path: "/", changeFrequency: "hourly", priority: 1 },
  { path: "/search", changeFrequency: "daily", priority: 0.8 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.2 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.2 },
];

export function buildSitemap(listings: readonly SitemapListing[], siteUrl: URL): MetadataRoute.Sitemap {
  const absolute = (path: string) => new URL(path, siteUrl).toString();
  return [
    ...STATIC_PAGES.map(({ path, changeFrequency, priority }) => ({ url: absolute(path), changeFrequency, priority })),
    ...listings.map((listing) => ({
      url: absolute(vehicleListingPath(listing)),
      ...(listing.updatedAt ? { lastModified: listing.updatedAt } : {}),
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
