// Mobil alt gezinme çubuğunun sekmeleri. UI'dan bağımsız: testleri
// lib/navigation.test.ts'de.

export type NavItemKey = "feed" | "search" | "sell" | "my-listings";

export type NavItem = { key: NavItemKey; href: string; label: string };

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "feed", href: "/", label: "Akış" },
  { key: "search", href: "/search", label: "Ara" },
  { key: "sell", href: "/sell", label: "İlan Ver" },
  { key: "my-listings", href: "/my-listings", label: "İlanlarım" },
];

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
