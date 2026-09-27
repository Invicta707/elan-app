import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

import {
  CATALOG_TTL_MS,
  EMPTY_FILTERS,
  clearCatalogCache,
  compareCatalogNames,
  countActiveFilters,
  fetchCatalog,
  fetchCatalogCached,
  filtersFromSearchParams,
  filtersToSearchParams,
  parseYear,
  searchVehicles,
  type Catalog,
  type SearchFilters,
} from "./search";
import { supabase } from "./supabase";

const catalog: Catalog = {
  brands: [{ id: "b-vw", name: "Volkswagen", slug: "volkswagen" }],
  models: [{ id: "m-passat", brandId: "b-vw", name: "Passat", slug: "passat" }],
};

const fullFilters: SearchFilters = {
  brandId: "b-vw",
  modelId: "m-passat",
  minPrice: 500000,
  maxPrice: 1000000,
  city: "İstanbul",
  videoOnly: true,
  minYear: 2015,
  maxYear: 2020,
  maxMileage: 150000,
  fuelTypes: ["dizel", "hibrit"],
  transmissions: ["otomatik"],
  bodyTypes: ["sedan", "suv"],
  hideHeavyDamage: true,
  sort: "price_asc",
};

function fromQuery(query: string): SearchFilters {
  return filtersFromSearchParams(Object.fromEntries(new URLSearchParams(query)), catalog);
}

describe("URL <-> filtre", () => {
  it("tüm filtreler URL'e yazılıp aynen geri okunur", () => {
    const query = filtersToSearchParams(fullFilters, catalog).toString();
    expect(fromQuery(query)).toEqual(fullFilters);
  });

  it("okunabilir Türkçe parametreler kullanır", () => {
    const params = filtersToSearchParams(fullFilters, catalog);
    expect(params.get("minYil")).toBe("2015");
    expect(params.get("maxKm")).toBe("150000");
    expect(params.get("yakit")).toBe("dizel,hibrit");
    expect(params.get("kasa")).toBe("sedan,suv");
    expect(params.get("hasarsiz")).toBe("1");
    expect(params.get("sirala")).toBe("fiyat-artan");
  });

  it("varsayılanlar URL'e yazılmaz", () => {
    expect(filtersToSearchParams(EMPTY_FILTERS, catalog).toString()).toBe("");
  });

  it("bilinmeyen değerler yok sayılır, sıra seçenek sırasına göre olur", () => {
    const filters = fromQuery("yakit=hibrit,roket,dizel,dizel&vites=yarı&kasa=suv&sirala=rastgele");
    expect(filters.fuelTypes).toEqual(["dizel", "hibrit"]);
    expect(filters.transmissions).toEqual([]);
    expect(filters.bodyTypes).toEqual(["suv"]);
    expect(filters.sort).toBe("newest");
  });

  it("ters girilen yıl aralığı düzeltilir, geçersiz yıl atılır", () => {
    expect(fromQuery("minYil=2020&maxYil=2015")).toMatchObject({ minYear: 2015, maxYear: 2020 });
    expect(fromQuery("minYil=1850&maxYil=20")).toMatchObject({ minYear: null, maxYear: null });
  });
});

describe("parseYear", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  it.each([
    ["2019", 2019],
    ["2027", 2027],
    ["2028", null],
    ["1969", null],
    ["19", null],
    ["", null],
  ])("%s → %s", (input, expected) => {
    expect(parseYear(input, now)).toBe(expected);
  });
});

describe("countActiveFilters", () => {
  it("sıralama filtre sayılmaz", () => {
    expect(countActiveFilters({ ...EMPTY_FILTERS, sort: "price_desc" })).toBe(0);
  });

  it("aralıklar ve listeler birer filtre sayılır", () => {
    expect(countActiveFilters(fullFilters)).toBe(11);
  });
});

describe("searchVehicles", () => {
  const rpc = vi.mocked(supabase.rpc);
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: [], error: null } as never);
  });

  it("yeni filtreleri RPC parametrelerine çevirir", async () => {
    await searchVehicles(fullFilters, 40);
    expect(rpc).toHaveBeenCalledWith(
      "search_vehicles",
      expect.objectContaining({
        p_min_year: 2015,
        p_max_year: 2020,
        p_max_mileage: 150000,
        p_fuel_types: ["dizel", "hibrit"],
        p_transmissions: ["otomatik"],
        p_body_types: ["sedan", "suv"],
        p_hide_heavy_damage: true,
        p_sort: "price_asc",
        p_offset: 40,
      }),
    );
  });

  it("boş listeler null gönderilir (filtre yok)", async () => {
    await searchVehicles(EMPTY_FILTERS);
    expect(rpc).toHaveBeenCalledWith(
      "search_vehicles",
      expect.objectContaining({
        p_fuel_types: null,
        p_transmissions: null,
        p_body_types: null,
        p_hide_heavy_damage: false,
        p_sort: "newest",
      }),
    );
  });
});

describe("compareCatalogNames", () => {
  const sorted = (names: string[]) => [...names].sort(compareCatalogNames);

  it("sayıları değerine göre sıralar: 208, 2008'den önce gelir", () => {
    expect(compareCatalogNames("208", "2008")).toBeLessThan(0);
    expect(sorted(["2008", "208", "3008", "308", "5008", "508"])).toEqual([
      "208",
      "308",
      "508",
      "2008",
      "3008",
      "5008",
    ]);
  });

  it("3, 10'dan önce gelir; ad içindeki sayılar da değerine göre karşılaştırılır", () => {
    expect(compareCatalogNames("3", "10")).toBeLessThan(0);
    expect(sorted(["Seri 10", "Seri 3", "Seri 1"])).toEqual(["Seri 1", "Seri 3", "Seri 10"]);
  });

  it("Türkçe alfabe sırası: Ç C'den, Ş S'den sonra; büyük/küçük harf fark etmez", () => {
    expect(sorted(["Şahin", "Doğan", "Çelik", "Sahara", "Clio"])).toEqual([
      "Clio",
      "Çelik",
      "Doğan",
      "Sahara",
      "Şahin",
    ]);
    // "i"siz örnek: Türkçede I'nın küçüğü ı'dır, "clio"/"CLIO" bu yüzden eşit sayılmaz
    expect(compareCatalogNames("polo", "POLO")).toBe(0);
  });
});

describe("fetchCatalog", () => {
  const from = vi.mocked(supabase.from);

  // from(tablo).select().eq(...).order("id").range(): ilk sayfada satırlar, sonra boş parça
  const filters: [string, string, unknown][] = [];
  function mockCatalogTables(rows: Record<string, unknown[]>) {
    filters.length = 0;
    from.mockImplementation(((table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => {
          filters.push([table, column, value]);
          return {
            order: () => ({
              range: async (start: number) => ({ data: start === 0 ? rows[table] : [], error: null }),
            }),
          };
        },
      }),
    })) as never);
  }

  it("kullanıcıların eklediği marka/modeller ortak listeye girmez", async () => {
    mockCatalogTables({ brands: [], models: [] });
    await fetchCatalog();
    expect(filters).toContainEqual(["brands", "is_user_created", false]);
    expect(filters).toContainEqual(["models", "is_user_created", false]);
  });

  it("markaları ve modelleri doğal sırayla döner (veritabanındaki id sırasından bağımsız)", async () => {
    mockCatalogTables({
      brands: [
        { id: "b2", name: "Peugeot", slug: "peugeot" },
        { id: "b1", name: "BMW", slug: "bmw" },
      ],
      models: [
        { id: "m1", brand_id: "b2", name: "2008", slug: "2008" },
        { id: "m2", brand_id: "b2", name: "208", slug: "208" },
        { id: "m3", brand_id: "b1", name: "3 Serisi", slug: "3-serisi" },
        { id: "m4", brand_id: "b1", name: "10 Serisi", slug: "10-serisi" },
        { id: "m5", brand_id: "b2", name: "3008", slug: "3008" },
        { id: "m6", brand_id: "b2", name: "308", slug: "308" },
      ],
    });

    const result = await fetchCatalog();
    expect(result.brands.map((b) => b.name)).toEqual(["BMW", "Peugeot"]);
    expect(result.models.filter((m) => m.brandId === "b2").map((m) => m.name)).toEqual([
      "208",
      "308",
      "2008",
      "3008",
    ]);
    expect(result.models.filter((m) => m.brandId === "b1").map((m) => m.name)).toEqual(["3 Serisi", "10 Serisi"]);
  });
});

describe("katalog: istek sayısı ve önbellek", () => {
  const from = vi.mocked(supabase.from);
  let rangeCalls: string[] = [];
  let fail = false;

  // Her tablo için satır listesi; range(start, end) o aralığı döner
  function mockTables(rows: Record<string, unknown[]>) {
    rangeCalls = [];
    from.mockImplementation(((table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            range: async (start: number, end: number) => {
              rangeCalls.push(`${table}:${start}`);
              if (fail) return { data: null, error: new Error("ağ hatası") };
              return { data: rows[table].slice(start, end + 1), error: null };
            },
          }),
        }),
      }),
    })) as never);
  }

  const brand = (i: number) => ({ id: `b${i}`, name: `Marka ${i}`, slug: `marka-${i}` });
  const model = (i: number) => ({ id: `m${i}`, brand_id: "b1", name: `Model ${i}`, slug: `model-${i}` });

  beforeEach(() => {
    fail = false;
    clearCatalogCache();
  });

  it("tek parça yetiyorsa boş parça için ikinci istek atılmaz (tablo başına tek istek)", async () => {
    mockTables({ brands: [brand(1), brand(2)], models: [model(1)] });
    await fetchCatalog();
    expect(rangeCalls.sort()).toEqual(["brands:0", "models:0"]);
  });

  it("parça tam doluysa sonraki parça istenir", async () => {
    mockTables({ brands: [brand(1)], models: Array.from({ length: 1005 }, (_, i) => model(i)) });
    const catalog = await fetchCatalog();
    expect(catalog.models).toHaveLength(1005);
    expect(rangeCalls.filter((c) => c.startsWith("models")).sort()).toEqual(["models:0", "models:1000"]);
  });

  it("fetchCatalogCached: aynı anda gelen istekler tek sorguyu paylaşır, süre dolunca yenilenir", async () => {
    mockTables({ brands: [brand(1)], models: [model(1)] });
    const [a, b] = await Promise.all([fetchCatalogCached(1_000), fetchCatalogCached(1_000)]);
    expect(a).toBe(b);
    expect(rangeCalls).toHaveLength(2);

    await fetchCatalogCached(1_000 + CATALOG_TTL_MS - 1);
    expect(rangeCalls).toHaveLength(2);

    await fetchCatalogCached(1_000 + CATALOG_TTL_MS);
    expect(rangeCalls).toHaveLength(4);
  });

  it("fetchCatalogCached: hata önbelleğe alınmaz, sonraki istek yeniden dener", async () => {
    mockTables({ brands: [brand(1)], models: [model(1)] });
    fail = true;
    await expect(fetchCatalogCached(5_000)).rejects.toThrow("ağ hatası");
    fail = false;
    await expect(fetchCatalogCached(5_001)).resolves.toMatchObject({ brands: [{ id: "b1" }] });
  });
});
