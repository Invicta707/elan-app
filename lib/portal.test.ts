import { beforeEach, describe, expect, it, vi } from "vitest";

// Vitrin ve filtreli akışın veri katmanı: search_vehicles + satıcı/yorum
// bilgisi birleştirme, takip akışı, adres (eş adlar, kanonik biçim, ?v=),
// filtre konsolunun taslağı, kart tarihi ve pencerenin klavye adımı.

vi.mock("./supabase", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

import type { FeedVehicle } from "./feed";
import {
  EMPTY_CONSOLE_DRAFT,
  MULTI_OPTION,
  PREVIEW_LOOP_SECONDS,
  buildHomeHref,
  consoleDraftFrom,
  feedVehicleFromPortal,
  fetchFilteredFeedPage,
  fetchFollowingPortalPage,
  fetchPortalVehicle,
  filterParamsNeedCatalog,
  filtersEqual,
  filtersFromConsoleDraft,
  filtersKey,
  formatListingDate,
  hasFilterParams,
  modalKeyStep,
  portalFiltersFromParams,
  portalVehicleFromFeed,
  portalVehicleFromSearch,
  previewLoopTime,
  searchPortalPage,
} from "./portal";
import { EMPTY_FILTERS, type Catalog, type SearchFilters, type VehicleSearchResult } from "./search";
import { supabase } from "./supabase";

const rpc = vi.mocked(supabase.rpc);
const from = vi.mocked(supabase.from);

// PostgREST sorgu zinciri: her çağrı kaydedilir, await edilince sonuç döner
function queryChain(result: unknown) {
  const calls: [string, ...unknown[]][] = [];
  const proxy: unknown = new Proxy(() => {}, {
    get(_target, prop) {
      if (prop === "then") return (resolve: (value: unknown) => void) => resolve(result);
      return (...args: unknown[]) => {
        calls.push([String(prop), ...args]);
        return proxy;
      };
    },
  });
  return { proxy, calls };
}

const catalog: Catalog = {
  brands: [
    { id: "b-bmw", name: "BMW", slug: "bmw" },
    { id: "b-mb", name: "Mercedes-Benz", slug: "mercedes-benz" },
    { id: "b-vw", name: "Volkswagen", slug: "volkswagen" },
  ],
  models: [
    { id: "m-320", brandId: "b-bmw", name: "3 Serisi", slug: "3-serisi" },
    { id: "m-c", brandId: "b-mb", name: "C Serisi", slug: "c-serisi" },
    { id: "m-passat", brandId: "b-vw", name: "Passat", slug: "passat" },
  ],
};

const searchRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  brand_id: "b-bmw",
  brand_name: "BMW",
  model_id: "m-320",
  model_name: "3 Serisi",
  year: 2019,
  price: "1250000",
  currency: "TRY",
  mileage_km: 85000,
  fuel_type: "dizel",
  transmission: "otomatik",
  body_type: "sedan",
  color: null,
  city: "İstanbul",
  tramer_amount: "0",
  has_heavy_damage: false,
  painted_parts_count: 1,
  changed_parts_count: 0,
  likes_count: 0,
  views_count: 0,
  saves_count: 0,
  created_at: "2026-09-27T10:00:00+00:00",
  cover_image_url: "https://x.supabase.co/storage/v1/object/public/vehicle-photos/v/0.jpeg",
  video_hls_url: `https://customer.cloudflarestream.com/${id}/manifest/video.m3u8`,
  video_thumbnail_url: `https://customer.cloudflarestream.com/${id}/thumbnails/thumbnail.jpg`,
  video_status: "ready",
  ...overrides,
});

const searchResult = (overrides: Partial<VehicleSearchResult> = {}): VehicleSearchResult => ({
  id: "veh-1",
  brandId: "b-bmw",
  brandName: "BMW",
  modelId: "m-320",
  modelName: "3 Serisi",
  year: 2019,
  price: 1_250_000,
  currency: "TRY",
  mileageKm: 85_000,
  fuelType: "dizel",
  transmission: "otomatik",
  bodyType: "sedan",
  color: null,
  city: "İstanbul",
  tramerAmount: 0,
  hasHeavyDamage: false,
  paintedPartsCount: 1,
  changedPartsCount: 0,
  likesCount: 0,
  viewsCount: 0,
  savesCount: 0,
  createdAt: "2026-09-27T10:00:00+00:00",
  coverImageUrl: "https://photo/cover.jpeg",
  videoHlsUrl: "https://video/v.m3u8",
  videoThumbnailUrl: "https://video/thumb.jpg",
  videoStatus: "ready",
  hasPlayableVideo: true,
  ...overrides,
});

const feedVehicle: FeedVehicle = {
  id: "veh-9",
  sellerId: "seller-9",
  brandName: "Fiat",
  modelName: "Egea",
  year: 2021,
  price: 990_000,
  currency: "TRY",
  mileageKm: 40_000,
  fuelType: "benzin",
  transmission: "manuel",
  city: "Bursa",
  tramerAmount: 0,
  hasHeavyDamage: false,
  paintedPartsCount: 0,
  changedPartsCount: 0,
  hlsUrl: "https://video/9.m3u8",
  thumbnailUrl: "https://video/9.jpg",
  commentsCount: 4,
  createdAt: "2026-09-26T08:00:00+00:00",
};

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("dönüşümler", () => {
  it("videolu ilanın kapağı videonun (dikey) karesi, satıcı ve yorum sayısı eklenir", () => {
    const vehicle = portalVehicleFromSearch(searchResult(), { sellerId: "s-1", commentsCount: 3 });
    expect(vehicle).toMatchObject({
      id: "veh-1",
      sellerId: "s-1",
      commentsCount: 3,
      hlsUrl: "https://video/v.m3u8",
      posterUrl: "https://video/thumb.jpg",
      createdAt: "2026-09-27T10:00:00+00:00",
    });
  });

  it("oynatılamayan videoda hls yok, kapak fotoğrafı; bilgi gelmediyse satıcı null, yorum 0", () => {
    const vehicle = portalVehicleFromSearch(
      searchResult({ hasPlayableVideo: false, videoStatus: "processing", videoHlsUrl: null }),
    );
    expect(vehicle).toMatchObject({ hlsUrl: null, posterUrl: "https://photo/cover.jpeg", sellerId: null, commentsCount: 0 });
  });

  it("akış ilanı ↔ vitrin ilanı gidiş dönüş aynı kalır; videosuz ilan akışa çevrilmez", () => {
    const portal = portalVehicleFromFeed(feedVehicle);
    expect(portal).toMatchObject({ posterUrl: "https://video/9.jpg", createdAt: "2026-09-26T08:00:00+00:00" });
    expect(feedVehicleFromPortal(portal)).toEqual(feedVehicle);
    expect(feedVehicleFromPortal({ ...portal, hlsUrl: null })).toBeNull();
  });
});

describe("searchPortalPage", () => {
  it("search_vehicles sonucuna satıcı kimliği ve yorum sayısını tek sorguyla ekler", async () => {
    rpc.mockResolvedValue({ data: [searchRow("a"), searchRow("b")], error: null } as never);
    const meta = queryChain({
      data: [
        { id: "a", seller_id: "seller-a", comments_count: 5 },
        { id: "b", seller_id: null, comments_count: null },
      ],
      error: null,
    });
    from.mockReturnValue(meta.proxy as never);

    const page = await searchPortalPage({ ...EMPTY_FILTERS, brandId: "b-bmw" }, 0, 20);

    expect(rpc).toHaveBeenCalledWith("search_vehicles", expect.objectContaining({ p_brand_id: "b-bmw", p_offset: 0, p_limit: 21 }));
    expect(from).toHaveBeenCalledWith("vehicles");
    expect(meta.calls).toContainEqual(["select", "id, seller_id, comments_count"]);
    expect(meta.calls).toContainEqual(["in", "id", ["a", "b"]]);
    expect(page.items.map((item) => [item.id, item.sellerId, item.commentsCount])).toEqual([
      ["a", "seller-a", 5],
      ["b", null, 0],
    ]);
    expect(page).toMatchObject({ next: 2, hasMore: false });
  });

  it("sonuç yoksa ikinci sorgu atılmaz; bir fazlası geldiyse devamı var", async () => {
    rpc.mockResolvedValue({ data: [], error: null } as never);
    await expect(searchPortalPage(EMPTY_FILTERS)).resolves.toMatchObject({ items: [], hasMore: false });
    expect(from).not.toHaveBeenCalled();

    rpc.mockResolvedValue({ data: [searchRow("a"), searchRow("b"), searchRow("c")], error: null } as never);
    from.mockReturnValue(queryChain({ data: [], error: null }).proxy as never);
    const page = await searchPortalPage(EMPTY_FILTERS, 40, 2);
    expect(rpc).toHaveBeenLastCalledWith("search_vehicles", expect.objectContaining({ p_offset: 40, p_limit: 3 }));
    expect(page).toMatchObject({ next: 42, hasMore: true });
    expect(page.items).toHaveLength(2);
  });

  it("RPC ya da satıcı sorgusu hatası yukarı iletilir", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("rpc failed") } as never);
    await expect(searchPortalPage(EMPTY_FILTERS)).rejects.toThrow("rpc failed");

    rpc.mockResolvedValue({ data: [searchRow("a")], error: null } as never);
    from.mockReturnValue(queryChain({ data: null, error: new Error("meta failed") }).proxy as never);
    await expect(searchPortalPage(EMPTY_FILTERS)).rejects.toThrow("meta failed");
  });

  it("tek alan dolu olsa da (esnek arama) yalnızca o süzgeç gider, diğerleri null", async () => {
    rpc.mockResolvedValue({ data: [], error: null } as never);
    await searchPortalPage({ ...EMPTY_FILTERS, minYear: 2018 });
    expect(rpc).toHaveBeenCalledWith(
      "search_vehicles",
      expect.objectContaining({
        p_min_year: 2018,
        p_brand_id: null,
        p_model_id: null,
        p_city: null,
        p_min_price: null,
        p_max_price: null,
        p_max_year: null,
        p_fuel_types: null,
        p_transmissions: null,
      }),
    );
  });
});

describe("fetchFilteredFeedPage (mobil filtreli akış)", () => {
  it("yalnızca videolu ilanları ister ve akış kartına çevirir", async () => {
    rpc.mockResolvedValue({ data: [searchRow("a")], error: null } as never);
    from.mockReturnValue(queryChain({ data: [{ id: "a", seller_id: "s", comments_count: 2 }], error: null }).proxy as never);

    const page = await fetchFilteredFeedPage({ ...EMPTY_FILTERS, city: "İstanbul", videoOnly: false }, 8, 8);

    expect(rpc).toHaveBeenCalledWith("search_vehicles", expect.objectContaining({ p_has_video_only: true, p_city: "İstanbul", p_offset: 8 }));
    expect(page.items[0]).toMatchObject({ id: "a", sellerId: "s", commentsCount: 2, hlsUrl: expect.stringContaining("a/manifest") });
    expect(page).toMatchObject({ nextOffset: 9, hasMore: false });
  });
});

describe("takip akışı ve paylaşılan ilan", () => {
  it("Takip Edilenler: following_feed üstünden, eklenme zamanıyla", async () => {
    const chain = queryChain({
      data: [
        {
          id: "veh-9",
          seller_id: "seller-9",
          created_at: "2026-09-27T10:00:00.123456+00:00",
          year: 2019,
          price: "990000",
          currency: "TRY",
          mileage_km: 120000,
          fuel_type: "dizel",
          transmission: "manuel",
          city: "Bursa",
          tramer_amount: "0",
          has_heavy_damage: false,
          painted_parts_count: 1,
          changed_parts_count: 0,
          comments_count: 3,
          brand: { name: "Fiat" },
          model: { name: "Egea" },
          videos: [{ hls_url: "https://video/9.m3u8", thumbnail_url: "https://video/9.jpg", order_index: 0 }],
        },
      ],
      error: null,
    });
    rpc.mockReturnValue(chain.proxy as never);

    const page = await fetchFollowingPortalPage(null, 20);
    expect(rpc).toHaveBeenCalledWith("following_feed");
    expect(page.items[0]).toMatchObject({
      id: "veh-9",
      sellerId: "seller-9",
      posterUrl: "https://video/9.jpg",
      createdAt: "2026-09-27T10:00:00.123456+00:00",
      commentsCount: 3,
    });
    expect(page.next).toEqual({ createdAt: "2026-09-27T10:00:00.123456+00:00", id: "veh-9" });
  });

  it("?v= ile gelen ilan yayında değilse null", async () => {
    from.mockReturnValue(queryChain({ data: null, error: null }).proxy as never);
    await expect(fetchPortalVehicle("11111111-1111-4111-8111-111111111111")).resolves.toBeNull();
    await expect(fetchPortalVehicle("bozuk-id")).resolves.toBeNull();
  });
});

describe("adres ↔ filtre", () => {
  const read = (query: string) => portalFiltersFromParams(new URLSearchParams(query), catalog);

  it("Türkçe parametreler /search ile aynı okunur", () => {
    expect(read("marka=bmw&model=3-serisi&minFiyat=500000&maxFiyat=1500000&sehir=istanbul&minYil=2015&maxYil=2020&vites=otomatik&yakit=dizel")).toEqual({
      ...EMPTY_FILTERS,
      brandId: "b-bmw",
      modelId: "m-320",
      minPrice: 500_000,
      maxPrice: 1_500_000,
      city: "İstanbul",
      minYear: 2015,
      maxYear: 2020,
      transmissions: ["otomatik"],
      fuelTypes: ["dizel"],
    });
  });

  it("İngilizce eş adlar ve adla yazılmış marka/model kabul edilir (?brand=BMW&minPrice=500000)", () => {
    expect(read("brand=BMW&minPrice=500000")).toMatchObject({ brandId: "b-bmw", minPrice: 500_000, modelId: null });
    expect(read("brand=mercedes%20benz&model=C%20Serisi&transmission=Otomatik&fuel=D%C4%B0ZEL")).toMatchObject({
      brandId: "b-mb",
      modelId: "m-c",
      transmissions: ["otomatik"],
      fuelTypes: ["dizel"],
    });
    expect(read("city=izmir&minYear=2018&maxYear=2016")).toMatchObject({ city: "İzmir", minYear: 2016, maxYear: 2018 });
  });

  it("Türkçe parametre eş addan önce gelir; bilinmeyen marka ve değerler yok sayılır", () => {
    expect(read("marka=volkswagen&brand=bmw")).toMatchObject({ brandId: "b-vw" });
    expect(read("marka=tesla&vites=yari&yakit=roket")).toEqual(EMPTY_FILTERS);
    // Model başka markanınsa uygulanmaz
    expect(read("marka=bmw&model=passat")).toMatchObject({ brandId: "b-bmw", modelId: null });
  });

  it("hangi parametre katalog ister, hangisi filtre sayılır", () => {
    expect(filterParamsNeedCatalog(new URLSearchParams("marka=bmw"))).toBe(true);
    expect(filterParamsNeedCatalog(new URLSearchParams("brand=BMW"))).toBe(true);
    expect(filterParamsNeedCatalog(new URLSearchParams("minFiyat=1&v=x"))).toBe(false);
    expect(hasFilterParams(new URLSearchParams("v=x&feed=following"))).toBe(false);
    expect(hasFilterParams(new URLSearchParams("maxPrice=5"))).toBe(true);
    expect(hasFilterParams({ sehir: "Ankara" })).toBe(true);
  });

  it("kanonik adres: önce filtreler, sonra diğer parametreler; ?v= yazılır/kaldırılır", () => {
    const filters: SearchFilters = { ...EMPTY_FILTERS, brandId: "b-bmw", minPrice: 500_000 };
    const current = new URLSearchParams("brand=BMW&minPrice=500000&feed=following&v=abc");
    expect(buildHomeHref(current, filters, catalog)).toBe("/?marka=bmw&minFiyat=500000&feed=following&v=abc");
    expect(buildHomeHref(current, filters, catalog, null)).toBe("/?marka=bmw&minFiyat=500000&feed=following");
    expect(buildHomeHref(new URLSearchParams(), EMPTY_FILTERS, catalog, "veh-1")).toBe("/?v=veh-1");
    expect(buildHomeHref(new URLSearchParams("minFiyat=5"), EMPTY_FILTERS, catalog)).toBe("/");
  });

  it("anahtar: aynı filtre aynı metin, varsayılanlar boş", () => {
    expect(filtersKey(EMPTY_FILTERS, catalog)).toBe("");
    expect(filtersKey(read("brand=BMW&sort=fiyat-artan"), catalog)).toBe("marka=bmw&sirala=fiyat-artan");
  });
});

describe("filtre konsolu taslağı", () => {
  const now = new Date("2026-09-28T12:00:00");
  const draft = (patch: Partial<typeof EMPTY_CONSOLE_DRAFT>) => ({ ...EMPTY_CONSOLE_DRAFT, ...patch });

  it.each([
    [{ brandId: "b-bmw" }, { brandId: "b-bmw" }],
    [{ city: "Ankara" }, { city: "Ankara" }],
    [{ minPrice: "500000" }, { minPrice: 500_000 }],
    [{ maxPrice: "900000" }, { maxPrice: 900_000 }],
    [{ minYear: "2015" }, { minYear: 2015 }],
    [{ maxYear: "2020" }, { maxYear: 2020 }],
    [{ transmission: "manuel" }, { transmissions: ["manuel"] }],
    [{ fuel: "lpg" }, { fuelTypes: ["lpg"] }],
  ])("yalnızca %o dolu: yalnızca o süzgeç uygulanır", (patch, expected) => {
    const { filters, errors } = filtersFromConsoleDraft(draft(patch), EMPTY_FILTERS, now);
    expect(filters).toEqual({ ...EMPTY_FILTERS, ...expected });
    expect(errors).toEqual({ price: null, year: null });
  });

  it("model markasız uygulanmaz; boş taslak filtresizdir", () => {
    expect(filtersFromConsoleDraft(draft({ modelId: "m-320" }), EMPTY_FILTERS, now).filters.modelId).toBeNull();
    expect(filtersFromConsoleDraft(EMPTY_CONSOLE_DRAFT, EMPTY_FILTERS, now).filters).toEqual(EMPTY_FILTERS);
  });

  it("ters fiyat aralığı hata: çift eski değerinde kalır", () => {
    const base = { ...EMPTY_FILTERS, minPrice: 100_000 };
    const { filters, errors } = filtersFromConsoleDraft(draft({ minPrice: "900000", maxPrice: "500000" }), base, now);
    expect(errors.price).toBe("En az fiyat, en çok fiyattan büyük olamaz.");
    expect(filters).toMatchObject({ minPrice: 100_000, maxPrice: null });
  });

  it("yarım yıl henüz süzgeç ve hata değil; aralık dışı ve ters yıl hata", () => {
    expect(filtersFromConsoleDraft(draft({ minYear: "20" }), EMPTY_FILTERS, now)).toEqual({
      filters: EMPTY_FILTERS,
      errors: { price: null, year: null },
    });
    expect(filtersFromConsoleDraft(draft({ minYear: "1950" }), EMPTY_FILTERS, now).errors.year).toBe(
      "Yıl 1970 ile 2027 arasında olmalı.",
    );
    expect(filtersFromConsoleDraft(draft({ minYear: "2022", maxYear: "2018" }), EMPTY_FILTERS, now).errors.year).toBe(
      "En eski yıl, en yeni yıldan büyük olamaz.",
    );
  });

  it("konsolda olmayan filtreler (km, kasa, ağır hasar, sıralama) korunur; çoklu seçim olduğu gibi kalır", () => {
    const base: SearchFilters = {
      ...EMPTY_FILTERS,
      maxMileage: 150_000,
      bodyTypes: ["suv"],
      hideHeavyDamage: true,
      sort: "price_asc",
      fuelTypes: ["dizel", "hibrit"],
    };
    const start = consoleDraftFrom(base);
    expect(start.fuel).toBe(MULTI_OPTION);
    const { filters } = filtersFromConsoleDraft({ ...start, city: "Bursa" }, base, now);
    expect(filters).toEqual({ ...base, city: "Bursa" });
    expect(filtersFromConsoleDraft({ ...start, fuel: "" }, base, now).filters.fuelTypes).toEqual([]);
  });

  it("taslak ↔ filtre gidiş dönüş aynı; karşılaştırma alan sırasına bağlı değil", () => {
    const filters = portalFiltersFromParams(new URLSearchParams("marka=bmw&minFiyat=5&maxYil=2020&vites=manuel"), catalog);
    const back = filtersFromConsoleDraft(consoleDraftFrom(filters), filters, now).filters;
    expect(filtersEqual(back, filters)).toBe(true);
    expect(filtersEqual(back, { ...filters, maxYear: 2021 })).toBe(false);
  });
});

describe("kart ve pencere yardımcıları", () => {
  it("eklenme günü takvim gününe göre", () => {
    const now = new Date(2026, 8, 28, 10, 0);
    expect(formatListingDate(new Date(2026, 8, 28, 0, 5).toISOString(), now)).toBe("Bugün");
    expect(formatListingDate(new Date(2026, 8, 27, 23, 59).toISOString(), now)).toBe("Dün");
    expect(formatListingDate(new Date(2026, 8, 24, 12).toISOString(), now)).toBe("4 gün önce");
    expect(formatListingDate(new Date(2026, 7, 19, 12).toISOString(), now)).toBe("19 Ağu");
    expect(formatListingDate(new Date(2025, 11, 3, 12).toISOString(), now)).toBe("3 Ara 2025");
    expect(formatListingDate("bozuk", now)).toBe("");
  });

  it("önizleme döngüsü ilk saniyelerde", () => {
    expect(previewLoopTime(PREVIEW_LOOP_SECONDS - 0.1)).toBeNull();
    expect(previewLoopTime(PREVIEW_LOOP_SECONDS)).toBe(0);
  });

  it("pencerede ↑/↓ adım; değiştirici tuş, yazı alanı ve iç pencere hariç", () => {
    const plain = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, defaultPrevented: false, target: null };
    const target = (closestMatch: string | null) =>
      ({ isContentEditable: false, closest: (selector: string) => (closestMatch && selector.includes(closestMatch) ? {} : null) }) as unknown as EventTarget;
    expect(modalKeyStep({ ...plain, key: "ArrowDown" })).toBe(1);
    expect(modalKeyStep({ ...plain, key: "ArrowUp" })).toBe(-1);
    expect(modalKeyStep({ ...plain, key: "PageDown" })).toBe(0);
    expect(modalKeyStep({ ...plain, key: "ArrowDown", shiftKey: true })).toBe(0);
    expect(modalKeyStep({ ...plain, key: "ArrowDown", defaultPrevented: true })).toBe(0);
    expect(modalKeyStep({ ...plain, key: "ArrowDown", target: target("textarea") })).toBe(0);
    expect(modalKeyStep({ ...plain, key: "ArrowDown", target: target("aria-modal") })).toBe(0);
    expect(modalKeyStep({ ...plain, key: "ArrowDown", target: target(null) })).toBe(1);
  });
});
