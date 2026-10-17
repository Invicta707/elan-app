// Mobil alt gezinme çubuğunun sekmeleri. UI'dan bağımsız: testleri
// lib/navigation.test.ts'de.

export type NavItemKey = "feed" | "search" | "sell" | "favorites" | "my-listings";

export type NavItem = { key: NavItemKey; href: string; label: string };

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "feed", href: "/", label: "Akış" },
  { key: "search", href: "/search", label: "Ara" },
  { key: "sell", href: "/sell", label: "İlan Ver" },
  { key: "favorites", href: "/favorites", label: "Favoriler" },
  { key: "my-listings", href: "/my-listings", label: "Vitrinim" },
];

/**
 * "Geri dön": kullanıcı sitenin başka bir sayfasından geldiyse tarayıcı
 * geçmişinde geri gidilir; paylaşılan linkle doğrudan geldiyse (referrer
 * başka site ya da yok) geri gitmek siteden çıkarırdı, o yüzden ana sayfaya.
 */
export function shouldNavigateBack(referrer: string, origin: string, historyLength: number): boolean {
  if (historyLength <= 1 || !referrer) return false;
  try {
    return new URL(referrer).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Sekme, kendi yolunda ya da onun alt yollarında etkindir: "/search" için
 * "/search" ve "/search/..." evet, "/searches" hayır. Akış ("/") sadece tam
 * eşleşmede etkindir, yoksa her sayfada etkin görünürdü.
 */
export function isNavItemActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Alt gezinme çubuğunun gizlendiği sayfalar: tam ekran sohbet (/messages/<id>) ve sürpriz sayfası */
export function isNavHidden(pathname: string | null): boolean {
  if (pathname === "/cansu-kamil") return true;
  return Boolean(pathname?.startsWith("/messages/") && pathname.length > "/messages/".length);
}
