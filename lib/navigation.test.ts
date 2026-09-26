import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isNavHidden, isNavItemActive, shouldNavigateBack } from "./navigation";

describe("shouldNavigateBack", () => {
  const origin = "https://elan.test";

  it("sitenin başka sayfasından gelindiyse geri gider", () => {
    expect(shouldNavigateBack("https://elan.test/search?kasa=suv", origin, 3)).toBe(true);
  });

  it("paylaşılan linkle doğrudan gelindiyse ana sayfaya gider", () => {
    expect(shouldNavigateBack("", origin, 1)).toBe(false);
    expect(shouldNavigateBack("", origin, 2)).toBe(false);
  });

  it("başka siteden (ör. WhatsApp web) gelindiyse siteden çıkarmaz", () => {
    expect(shouldNavigateBack("https://web.whatsapp.com/", origin, 3)).toBe(false);
  });

  it("geçmiş yoksa ya da referrer bozuksa ana sayfaya gider", () => {
    expect(shouldNavigateBack("https://elan.test/", origin, 1)).toBe(false);
    expect(shouldNavigateBack("not a url", origin, 3)).toBe(false);
  });
});

function activeKeys(pathname: string | null) {
  return NAV_ITEMS.filter((item) => isNavItemActive(item.href, pathname)).map((item) => item.key);
}

describe("isNavItemActive", () => {
  it.each([
    ["/", ["feed"]],
    ["/search", ["search"]],
    ["/sell", ["sell"]],
    ["/favorites", ["favorites"]],
    ["/my-listings", ["my-listings"]],
  ])("%s → yalnızca %j etkin", (pathname, expected) => {
    expect(activeKeys(pathname)).toEqual(expected);
  });

  it("alt yollarda da etkin", () => {
    expect(activeKeys("/my-listings/abc")).toEqual(["my-listings"]);
  });

  it("yalnızca ön eki benzeyen yollarda etkin değil", () => {
    expect(activeKeys("/searches")).toEqual([]);
    expect(activeKeys("/sellers")).toEqual([]);
  });

  it("akış başka sayfalarda etkin görünmez", () => {
    for (const pathname of ["/search", "/sell", "/favorites", "/my-listings", "/bilinmeyen"]) {
      expect(isNavItemActive("/", pathname)).toBe(false);
    }
  });

  it("yol bilinmiyorsa (null) hiçbiri etkin değil", () => {
    expect(activeKeys(null)).toEqual([]);
  });

  it("beş sekme, sırası sabit; İlan Ver ortada", () => {
    expect(NAV_ITEMS.map((i) => [i.href, i.label])).toEqual([
      ["/", "Akış"],
      ["/search", "Ara"],
      ["/sell", "İlan Ver"],
      ["/favorites", "Favoriler"],
      ["/my-listings", "Vitrinim"],
    ]);
  });
});

describe("isNavHidden", () => {
  it("yalnızca tam ekran sohbette alt çubuk gizlenir", () => {
    expect(isNavHidden("/messages/abc")).toBe(true);
    expect(isNavHidden("/messages")).toBe(false);
    expect(isNavHidden("/messages/")).toBe(false);
    expect(isNavHidden("/my-listings")).toBe(false);
    expect(isNavHidden(null)).toBe(false);
  });
});
