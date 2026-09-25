import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isNavItemActive } from "./navigation";

function activeKeys(pathname: string | null) {
  return NAV_ITEMS.filter((item) => isNavItemActive(item.href, pathname)).map((item) => item.key);
}

describe("isNavItemActive", () => {
  it.each([
    ["/", ["feed"]],
    ["/search", ["search"]],
    ["/sell", ["sell"]],
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
    for (const pathname of ["/search", "/sell", "/my-listings", "/bilinmeyen"]) {
      expect(isNavItemActive("/", pathname)).toBe(false);
    }
  });

  it("yol bilinmiyorsa (null) hiçbiri etkin değil", () => {
    expect(activeKeys(null)).toEqual([]);
  });

  it("dört sekme, sırası sabit", () => {
    expect(NAV_ITEMS.map((i) => [i.href, i.label])).toEqual([
      ["/", "Akış"],
      ["/search", "Ara"],
      ["/sell", "İlan Ver"],
      ["/my-listings", "İlanlarım"],
    ]);
  });
});
