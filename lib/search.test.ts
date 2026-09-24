import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: { rpc: vi.fn() } }));

import {
  EMPTY_FILTERS,
  countActiveFilters,
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
