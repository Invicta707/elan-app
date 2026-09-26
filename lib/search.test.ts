import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

import {
  EMPTY_FILTERS,
  compareCatalogNames,
  countActiveFilters,
  fetchCatalog,
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

  // from(tablo).select().order("id").range(): ilk sayfada satırlar, sonra boş parça
  function mockCatalogTables(rows: Record<string, unknown[]>) {
    from.mockImplementation(((table: string) => ({
      select: () => ({
        order: () => ({
          range: async (start: number) => ({ data: start === 0 ? rows[table] : [], error: null }),
        }),
      }),
    })) as never);
  }

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
