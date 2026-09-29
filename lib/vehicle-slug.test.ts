import { describe, expect, it } from "vitest";
import {
  MAX_SLUG_LENGTH,
  listingSegment,
  parseListingSegment,
  slugify,
  vehicleIdPath,
  vehicleListingPath,
  vehicleSlug,
} from "./vehicle-slug";

const ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

describe("slugify", () => {
  it("Türkçe harfleri ASCII'ye çevirir (büyük harfler dahil)", () => {
    expect(slugify("Çanakkale Ğ Işık İzmir Ömer Şişli Ünye")).toBe("canakkale-g-isik-izmir-omer-sisli-unye");
    expect(slugify("ÇĞIİÖŞÜ çğıiöşü")).toBe("cgiiosu-cgiiosu");
  });

  it("Türkçe küçük harf kuralı: I → ı → i (CLIO → clio), İ → i", () => {
    expect(slugify("CLIO")).toBe("clio");
    expect(slugify("MINI Cooper")).toBe("mini-cooper");
    expect(slugify("İSTANBUL")).toBe("istanbul");
  });

  it("aksanlı yabancı harfler, noktalama ve boşluklar tek tire olur; baş/son tire yok", () => {
    expect(slugify("Mercedes-Benz C 200")).toBe("mercedes-benz-c-200");
    expect(slugify("Škoda Citroën  É-Class!")).toBe("skoda-citroen-e-class");
    expect(slugify("  --Alfa   Romeo & Co.--  ")).toBe("alfa-romeo-co");
    expect(slugify("")).toBe("");
    expect(slugify("???")).toBe("");
  });
});

describe("vehicleSlug", () => {
  it("yıl, marka, model, kasa tipi, il sırasıyla (örnekteki adres)", () => {
    expect(vehicleSlug({ year: 2021, brandName: "BMW", modelName: "320i", bodyType: "sedan", city: "İzmir" })).toBe(
      "2021-bmw-320i-sedan-izmir",
    );
  });

  it("kasa tipi Türkçe etiketiyle; boş alanlar atlanır", () => {
    expect(
      vehicleSlug({ year: 2018, brandName: "Volkswagen", modelName: "Passat", bodyType: "station_wagon", city: "Muğla" }),
    ).toBe("2018-volkswagen-passat-station-wagon-mugla");
    expect(vehicleSlug({ year: 2020, brandName: "Fiat", modelName: "Egea", bodyType: null, city: null })).toBe("2020-fiat-egea");
    expect(vehicleSlug({ year: 2020, brandName: "Fiat", modelName: "Egea" })).toBe("2020-fiat-egea");
  });

  it(`uzun adlar ${MAX_SLUG_LENGTH} karakterde, kelime sınırında kesilir`, () => {
    const slug = vehicleSlug({ year: 2015, brandName: "Marka", modelName: "Çok uzun ".repeat(20), city: "Ankara" });
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug.startsWith("2015-marka-cok-uzun-")).toBe(true);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug).toMatch(/(^|-)(cok|uzun)$/);
  });
});

describe("vehicleListingPath / vehicleIdPath", () => {
  it("/ilan/<slug>-<id>; kimlik küçük harfe çevrilir", () => {
    const vehicle = { id: ID.toUpperCase(), year: 2021, brandName: "BMW", modelName: "320i", bodyType: "sedan" as const, city: "İzmir" };
    expect(vehicleListingPath(vehicle)).toBe(`/ilan/2021-bmw-320i-sedan-izmir-${ID}`);
    expect(listingSegment(vehicle)).toBe(`2021-bmw-320i-sedan-izmir-${ID}`);
  });

  it("slug boşsa yalnızca kimlik; kimlik bilinen yerler için /ilan/<id>", () => {
    expect(vehicleListingPath({ id: ID, year: null, brandName: "", modelName: "" })).toBe(`/ilan/${ID}`);
    expect(vehicleIdPath(ID)).toBe(`/ilan/${ID}`);
  });
});

describe("parseListingSegment", () => {
  it("kimlik sondaki UUID; slug geri kalanı", () => {
    expect(parseListingSegment(`2021-bmw-320i-sedan-izmir-${ID}`)).toEqual({ id: ID, slug: "2021-bmw-320i-sedan-izmir" });
  });

  it("yalnızca kimlik, büyük harfli kimlik ve eski/yanlış slug da kimliği verir", () => {
    expect(parseListingSegment(ID)).toEqual({ id: ID, slug: "" });
    expect(parseListingSegment(`x-${ID.toUpperCase()}`)).toEqual({ id: ID, slug: "x" });
    expect(parseListingSegment(`2019-eski-model-${ID}`)?.id).toBe(ID);
  });

  it("yüzde kodlu Türkçe slug çözülür; bozuk kodlama hata vermez", () => {
    expect(parseListingSegment(`2021-%C3%A7-${ID}`)).toEqual({ id: ID, slug: "2021-ç" });
    expect(parseListingSegment(`%E0%A4%A-${ID}`)?.id).toBe(ID);
  });

  it("UUID yoksa, sonda değilse ya da ayraçsız yapışıksa null", () => {
    expect(parseListingSegment("2021-bmw-320i")).toBeNull();
    expect(parseListingSegment(`${ID}-2021-bmw`)).toBeNull();
    expect(parseListingSegment(`bmw${ID}`)).toBeNull();
    expect(parseListingSegment("")).toBeNull();
  });

  it("üretilen her adres geri ayrıştırılır (gidiş dönüş)", () => {
    const vehicle = { id: ID, year: 2012, brandName: "Renault", modelName: "Mégane", bodyType: "hatchback" as const, city: "Şanlıurfa" };
    const segment = listingSegment(vehicle);
    expect(parseListingSegment(segment)).toEqual({ id: ID, slug: "2012-renault-megane-hatchback-sanliurfa" });
  });
});
