import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import {
  CATALOG_FOLD_FROM,
  CATALOG_FOLD_TO,
  MAX_MODEL_NAME,
  catalogKey,
  catalogNameError,
  cleanCatalogName,
  editDistance,
  findExactOption,
  searchCatalog,
  type CatalogOption,
} from "./catalog-search";

const options = (names: string[]): CatalogOption[] => names.map((name, i) => ({ id: `id-${i}`, name }));
const names = (list: CatalogOption[]) => list.map((o) => o.name);

// Uzak katalogdan (2026-09-26)
const BMW = options(["1 Serisi", "2 Serisi", "3 Serisi", "4 Serisi", "5 Serisi", "7 Serisi", "i4", "iX", "iX1", "X1", "X2", "X3", "X4", "X5", "X6", "X7", "Z4"]);
const MERCEDES = options(["A Serisi", "B Serisi", "C Serisi", "CLA", "CLS", "E Serisi", "EQA", "EQB", "G Serisi", "GLA", "GLB", "GLC", "GLE", "GLS", "S Serisi", "Vito"]);
const TOYOTA = options(["Auris", "C-HR", "Camry", "Corolla", "Corolla Cross", "Hilux", "Land Cruiser", "Proace City", "RAV4", "Verso", "Yaris", "Yaris Cross"]);
const PEUGEOT = options(["2008", "206", "207", "208", "3008", "301", "308", "408", "5008", "508", "Partner", "Rifter"]);
const BRANDS = options(["Alfa Romeo", "Audi", "BMW", "Citroën", "Mercedes-Benz", "Škoda", "Volkswagen", "Volvo"]);

describe("catalogKey", () => {
  it.each([
    ["Mercedes-Benz", "mercedesbenz"],
    ["  mercedes   BENZ ", "mercedesbenz"],
    ["C-HR", "chr"],
    ["Škoda", "skoda"],
    ["Citroën", "citroen"],
    ["İSTANBUL ışık Şahin Ğ", "istanbulisiksahing"],
    ["3 Serisi", "3serisi"],
    ["!!!", ""],
  ])("%s → %s", (name, key) => {
    expect(catalogKey(name)).toBe(key);
  });

  it("harf tabloları eşit uzunlukta (SQL translate ile aynı)", () => {
    expect([...CATALOG_FOLD_FROM]).toHaveLength([...CATALOG_FOLD_TO].length);
  });
});

describe("searchCatalog", () => {
  it("'320' yazınca 3 Serisi en üstte (seri eşleşmesi); 320i/320d olsa onlar daha üstte", () => {
    expect(names(searchCatalog(BMW, "320"))[0]).toBe("3 Serisi");
    const withTrims = options(["3 Serisi", "320i", "320d", "X3", "M340i"]);
    expect(names(searchCatalog(withTrims, "320")).slice(0, 3)).toEqual(["320d", "320i", "3 Serisi"]);
  });

  it("Mercedes kodları: c200 → C Serisi, gla200 → GLA", () => {
    expect(names(searchCatalog(MERCEDES, "c200"))[0]).toBe("C Serisi");
    expect(names(searchCatalog(MERCEDES, "gla 200"))[0]).toBe("GLA");
  });

  it("adın başı, sonra kelimenin başı, sonra içinde geçen", () => {
    expect(names(searchCatalog(TOYOTA, "cro"))).toEqual(["Corolla Cross", "Yaris Cross"]);
    expect(names(searchCatalog(TOYOTA, "cor"))).toEqual(["Corolla", "Corolla Cross"]);
    expect(names(searchCatalog(TOYOTA, "ruis"))).toEqual(["Land Cruiser"]);
  });

  it("yazım hatalarına dayanıklı", () => {
    expect(names(searchCatalog(TOYOTA, "corola"))[0]).toBe("Corolla");
    expect(names(searchCatalog(TOYOTA, "yarsi"))[0]).toBe("Yaris");
    expect(names(searchCatalog(BRANDS, "volksvagen"))[0]).toBe("Volkswagen");
    expect(names(searchCatalog(BRANDS, "mercedes benz"))[0]).toBe("Mercedes-Benz");
  });

  it("Türkçe ve aksanlı harfler, noktalama önemsiz", () => {
    expect(names(searchCatalog(BRANDS, "skoda"))).toEqual(["Škoda"]);
    expect(names(searchCatalog(BRANDS, "CITROEN"))).toEqual(["Citroën"]);
    expect(names(searchCatalog(TOYOTA, "chr"))[0]).toBe("C-HR");
  });

  it("birebir eşleşme ilk sırada; eşit puanlılar doğal sırayla", () => {
    expect(names(searchCatalog(PEUGEOT, "208"))[0]).toBe("208");
    expect(names(searchCatalog(PEUGEOT, "20"))).toEqual(["206", "207", "208", "2008"]);
  });

  it("boş sorguda hepsi doğal sırayla; alakasız sorguda sonuç yok", () => {
    expect(names(searchCatalog(PEUGEOT, "  ")).slice(0, 4)).toEqual(["206", "207", "208", "301"]);
    expect(searchCatalog(TOYOTA, "zzzz")).toEqual([]);
  });

  it("kısa sorguda yazım hatası toleransı yok (gürültü olmasın)", () => {
    expect(names(searchCatalog(BMW, "x9"))).toEqual([]);
  });
});

describe("findExactOption", () => {
  it("anahtarı aynı olan seçeneği bulur", () => {
    expect(findExactOption(TOYOTA, "  c hr ")?.name).toBe("C-HR");
    expect(findExactOption(BRANDS, "mercedes benz")?.name).toBe("Mercedes-Benz");
    expect(findExactOption(TOYOTA, "Corolla Crosss")).toBeUndefined();
    expect(findExactOption(TOYOTA, "")).toBeUndefined();
  });
});

describe("editDistance", () => {
  it.each([
    ["corola", "corolla", 1],
    ["yarsi", "yaris", 1],
    ["abc", "abc", 0],
    ["", "abc", 3],
  ])("%s ↔ %s = %i", (a, b, distance) => {
    expect(editDistance(a, b)).toBe(distance);
  });
});

describe("serbest girilen ad", () => {
  it("boşluklar sadeleşir", () => {
    expect(cleanCatalogName("  M340i    xDrive ")).toBe("M340i xDrive");
  });

  it.each(["M340i xDrive", "Şahin 1.6", "C-HR Hybrid", "e-tron GT", "A&B Özel", "Model 3/Y", "D'Artagnan"])(
    "geçerli: %s",
    (name) => {
      expect(catalogNameError(name, MAX_MODEL_NAME)).toBeNull();
    },
  );

  it.each([
    ["", "Bir ad yaz."],
    ["   ", "Bir ad yaz."],
    ["a".repeat(61), "En fazla 60 karakter olabilir."],
    ["<script>", "Yalnızca harf, rakam, boşluk ve - . / + & ' kullanılabilir."],
    ["-X", "Yalnızca harf, rakam, boşluk ve - . / + & ' kullanılabilir."],
    ["Ş", "Yalnızca harf, rakam, boşluk ve - . / + & ' kullanılabilir."],
    ["Model #1", "Yalnızca harf, rakam, boşluk ve - . / + & ' kullanılabilir."],
  ])("geçersiz: %j", (name, message) => {
    expect(catalogNameError(name, MAX_MODEL_NAME)).toBe(message);
  });
});
