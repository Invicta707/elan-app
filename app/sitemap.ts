import type { MetadataRoute } from "next";
import { buildSitemap, fetchSitemapListings } from "../lib/sitemap";
import { currentSiteUrl } from "../lib/site-url";

// /sitemap.xml: yayındaki ilanların güncel /ilan/… adresleri (lib/sitemap.ts).
// İstek anında üretilir: yeni ilan hemen girer, satılan hemen çıkar; build
// sırasında veritabanına gidilmez (lib/supabase.ts'in kuralı). Tarayıcılar
// sitemap'i seyrek okur, her istekte en fazla birkaç sorgu.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemap(await fetchSitemapListings(), currentSiteUrl());
}
