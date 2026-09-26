import type { VehicleStatus } from "./listing-status";
import { currencySymbol, formatAmount } from "./search";

// Vitrinim ızgarası: dar karelere sığan kısa fiyat ve sayı biçimleri. UI'dan bağımsız.

const compactFormatter = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const millionFormatter = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });

/** Kare üstündeki fiyat: 1 milyonun altı tam ("₺850.000"), üstü kısa ("₺1,25 Mn", bölünmez boşlukla) */
export function formatTilePrice(price: number, currency: string): string {
  const symbol = currencySymbol(currency);
  if (price >= 1_000_000) return `${symbol}${millionFormatter.format(Math.floor(price / 10_000) / 100)} Mn`;
  return `${symbol}${formatAmount(price)}`;
}

/** Görüntülenme: 999, "1,2 B", "3,4 Mn" */
export function formatCount(count: number): string {
  return compactFormatter.format(Math.max(0, Math.floor(count)));
}

export function isLive(status: VehicleStatus): boolean {
  return status === "active";
}

export function showcaseStats(listings: readonly { status: VehicleStatus; viewsCount: number }[]) {
  return {
    total: listings.length,
    live: listings.filter((l) => isLive(l.status)).length,
    views: listings.reduce((sum, l) => sum + l.viewsCount, 0),
  };
}
