// Sitenin kök adresi: app/layout.tsx'teki metadataBase. Canonical ve OpenGraph
// (WhatsApp/sosyal medya kartı) gibi göreli adresler buna göre tamamlanır.
// UI'dan bağımsız: testleri lib/site-url.test.ts'de.
//
// Hiçbir durumda hata fırlatmaz: değişken boş ya da bozuk gelse de build düşmez.

export type SiteUrlEnv = {
  NEXT_PUBLIC_SITE_URL?: string;
  // Vercel sistem değişkenleri (şemasız alan adı, ör. "elan-app.vercel.app").
  // Next.js'in OG görselleri için kullandığı yedekle aynı sıra.
  VERCEL_ENV?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_BRANCH_URL?: string;
  VERCEL_URL?: string;
};

// Alan adı dışarıdan verilmezse ve Vercel dışında çalışılıyorsa
const DEFAULT_SITE_URL = "https://gozuyle.com";

/**
 * Öncelik:
 *   1. NEXT_PUBLIC_SITE_URL (şemasız yazılırsa https:// eklenir)
 *   2. Vercel önizleme deploy'unda o deploy'un adresi
 *   3. Vercel'de projenin canlı alan adı (özel alan adı bağlıysa o)
 *   4. https://gozuyle.com
 */
export function resolveSiteUrl(env: SiteUrlEnv): URL {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim();
  const url = configured ? parseHttpUrl(configured) : null;
  if (url) return url;

  const fallback = fallbackUrl(env);
  // Boş değer "tanımlanmamış" sayılır; sadece yanlış yazılmış değer uyarı verir
  if (configured) {
    console.warn(`NEXT_PUBLIC_SITE_URL geçerli bir adres değil ("${configured}"); yerine ${fallback.origin} kullanılıyor.`);
  }
  return fallback;
}

/** Sunucuda çalışan kod için (metadataBase, sitemap, robots, JSON-LD): ortamdan okunan kök adres */
export function currentSiteUrl(): URL {
  return resolveSiteUrl({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
    VERCEL_URL: process.env.VERCEL_URL,
  });
}

function fallbackUrl(env: SiteUrlEnv): URL {
  const previewHost =
    env.VERCEL_ENV === "preview" ? (env.VERCEL_BRANCH_URL?.trim() || env.VERCEL_URL?.trim()) : undefined;
  const host = previewHost || env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || env.VERCEL_URL?.trim();
  return (host && parseHttpUrl(host)) || new URL(DEFAULT_SITE_URL);
}

function parseHttpUrl(value: string): URL | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}
