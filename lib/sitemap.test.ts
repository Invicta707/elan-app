import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/sitemap.ts: yalnızca yayındaki, deneme olmayan ilanların /ilan/… adresleri.
// Supabase sorgusu zincirlenebilir bir taklitle izlenir.

const db = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const pages: unknown[][] = [];
  let error: unknown = null;
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ["select", "eq", "order"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.range = (...args: unknown[]) => {
    calls.push({ method: "range", args });
    return Promise.resolve(error ? { data: null, error } : { data: pages.shift() ?? [], error: null });
  };
  return {
    calls,
    pages,
    setError: (value: unknown) => {
      error = value;
    },
    from: vi.fn(() => builder),
  };
});
vi.mock("./supabase", () => ({ supabase: { from: db.from } }));

import robots from "../app/robots";
import { SITEMAP_PAGE_SIZE, buildSitemap, fetchSitemapListings, type SitemapListing } from "./sitemap";

const SITE = new URL("https://gozuyle.com");

function row(n: number) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    year: 2021,
    body_type: "sedan",
    city: "İzmir",
    updated_at: "2026-09-29T10:00:00+00:00",
    brand: { name: "BMW" },
    model: { name: "320i" },
  };
}

beforeEach(() => {
  db.calls.length = 0;
  db.pages.length = 0;
  db.setError(null);
  db.from.mockClear();
});

describe("fetchSitemapListings", () => {
  it("yalnızca yayındaki ve deneme olmayan ilanlar; en son güncellenen önce", async () => {
    db.pages.push([row(1)]);
    const listings = await fetchSitemapListings();
    expect(db.from).toHaveBeenCalledWith("vehicles");
    expect(db.calls).toContainEqual({ method: "eq", args: ["status", "active"] });
    expect(db.calls).toContainEqual({ method: "eq", args: ["is_test", false] });
    expect(db.calls).toContainEqual({ method: "order", args: ["updated_at", { ascending: false }] });
    expect(listings).toEqual([
      {
        id: row(1).id,
        year: 2021,
        brandName: "BMW",
        modelName: "320i",
        bodyType: "sedan",
        city: "İzmir",
        updatedAt: "2026-09-29T10:00:00+00:00",
      },
    ]);
  });

  it("1000'lik sayfalarla okur; eksik sayfa gelince durur", async () => {
    db.pages.push(Array.from({ length: SITEMAP_PAGE_SIZE }, (_, i) => row(i)), [row(5000)]);
    const listings = await fetchSitemapListings();
    expect(listings).toHaveLength(SITEMAP_PAGE_SIZE + 1);
    const ranges = db.calls.filter((call) => call.method === "range").map((call) => call.args);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("üst sınırı aşmaz", async () => {
    db.pages.push(Array.from({ length: 5 }, (_, i) => row(i)));
    await fetchSitemapListings(5);
    expect(db.calls.filter((call) => call.method === "range").map((call) => call.args)).toEqual([[0, 4]]);
  });

  it("veritabanı hatası yutulmaz (eski sitemap boş listeyle ezilmesin)", async () => {
    db.setError({ message: "boom" });
    await expect(fetchSitemapListings()).rejects.toEqual({ message: "boom" });
  });
});

describe("buildSitemap", () => {
  const listing: SitemapListing = {
    id: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
    year: 2021,
    brandName: "BMW",
    modelName: "320i",
    bodyType: "sedan",
    city: "İzmir",
    updatedAt: "2026-09-29T10:00:00+00:00",
  };

  it("sabit sayfalar ve ilanların mutlak, güncel slug adresleri", () => {
    const entries = buildSitemap([listing, { ...listing, id: "2b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", updatedAt: null }], SITE);
    expect(entries.map((entry) => entry.url)).toEqual([
      "https://gozuyle.com/",
      "https://gozuyle.com/search",
      "https://gozuyle.com/privacy",
      "https://gozuyle.com/terms",
      "https://gozuyle.com/ilan/2021-bmw-320i-sedan-izmir-1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
      "https://gozuyle.com/ilan/2021-bmw-320i-sedan-izmir-2b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
    ]);
    expect(entries[4]).toMatchObject({ lastModified: "2026-09-29T10:00:00+00:00", changeFrequency: "daily", priority: 0.7 });
    expect(entries[5]).not.toHaveProperty("lastModified");
    expect(entries[0]).toMatchObject({ changeFrequency: "hourly", priority: 1 });
  });

  it("giriş isteyen ve yönetim sayfaları yok", () => {
    const urls = buildSitemap([], SITE).map((entry) => entry.url);
    for (const path of ["/sell", "/admin", "/messages", "/settings", "/my-listings", "/favorites"]) {
      expect(urls.some((url) => url.includes(path))).toBe(false);
    }
  });
});

describe("robots.txt", () => {
  it("sitemap adresi; yönetim ve API taranmaz, paylaşım afişi açık", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://gozuyle.com");
    const rules = robots();
    vi.unstubAllEnvs();
    expect(rules.sitemap).toBe("https://gozuyle.com/sitemap.xml");
    expect(rules.rules).toEqual({ userAgent: "*", allow: ["/", "/api/og/"], disallow: ["/admin", "/api/"] });
  });
});
