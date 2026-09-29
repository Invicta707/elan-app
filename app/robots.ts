import type { MetadataRoute } from "next";
import { currentSiteUrl } from "../lib/site-url";

// /robots.txt: sitemap'in adresi; yönetim ve API uçları taranmaz. Paylaşım
// afişi (/api/og/…) açık kalır: sosyal ağların önizleme botları okuyabilsin.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/api/og/"],
      disallow: ["/admin", "/api/"],
    },
    sitemap: new URL("/sitemap.xml", currentSiteUrl()).toString(),
  };
}
