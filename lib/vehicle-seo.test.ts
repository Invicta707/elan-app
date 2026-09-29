import { describe, expect, it } from "vitest";
import type { VehiclePageData } from "./vehicle-page";
import { buildVehicleJsonLd, buildVehicleMetadata, serializeJsonLd } from "./vehicle-seo";

const ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const PATH = `/ilan/2021-bmw-320i-sedan-izmir-${ID}`;
const SITE = new URL("https://gozuyle.com");

const vehicle: VehiclePageData = {
  id: ID,
  sellerId: "seller-1",
  status: "active",
  brandName: "BMW",
  modelName: "320i",
  year: 2021,
  mileageKm: 85_000,
  price: 1_850_000,
  currency: "TRY",
  fuelType: "benzin",
  transmission: "otomatik",
  bodyType: "sedan",
  city: "İzmir",
  hasHeavyDamage: false,
  description: "Bakımlı, garaj arabası.",
  photoUrls: ["https://x.supabase.co/storage/v1/object/public/vehicle-photos/a/0.jpeg", "https://x/1.jpeg"],
  videoThumbnailUrl: "https://video/thumb.jpg",
  hasPlayableVideo: true,
};

describe("buildVehicleMetadata", () => {
  it("canonical ve OpenGraph adresi ilanın tam /ilan/… yolu; afiş fiyatla sürümlenir", () => {
    const metadata = buildVehicleMetadata(vehicle);
    expect(metadata.alternates?.canonical).toBe(PATH);
    expect(metadata.openGraph).toMatchObject({ url: PATH, siteName: "gözüyle", locale: "tr_TR" });
    expect(metadata.title).toBe("2021 BMW 320i - ₺1.850.000");
    expect(JSON.stringify(metadata.openGraph)).toContain(`/api/og/vehicle/${ID}?v=1850000`);
    expect(metadata.robots).toBeUndefined();
  });

  it("deneme ilanı dizine eklenmez (noindex), bağlantıları izlenir", () => {
    expect(buildVehicleMetadata({ ...vehicle, isTest: true }).robots).toEqual({ index: false, follow: true });
  });

  it("yayında olmayan ilanda afiş yok", () => {
    const metadata = buildVehicleMetadata({ ...vehicle, status: "sold" });
    expect(metadata.openGraph?.images).toBeUndefined();
    expect(metadata.twitter).toMatchObject({ card: "summary" });
  });
});

describe("buildVehicleJsonLd (schema.org Product + Car)", () => {
  it("fiyat teklifi, marka/model, model yılı, km (KMT), yakıt, vites, kasa ve konum", () => {
    const data = buildVehicleJsonLd(vehicle, SITE);
    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": ["Product", "Car"],
      "@id": `https://gozuyle.com${PATH}#arac`,
      name: "2021 BMW 320i",
      url: `https://gozuyle.com${PATH}`,
      sku: ID,
      description: "Bakımlı, garaj arabası.",
      image: vehicle.photoUrls,
      brand: { "@type": "Brand", name: "BMW" },
      model: "320i",
      vehicleModelDate: "2021",
      mileageFromOdometer: { "@type": "QuantitativeValue", value: 85_000, unitCode: "KMT", unitText: "km" },
      fuelType: "Benzin",
      vehicleTransmission: "Otomatik",
      bodyType: "Sedan",
      itemCondition: "https://schema.org/UsedCondition",
      offers: {
        "@type": "Offer",
        url: `https://gozuyle.com${PATH}`,
        price: 1_850_000,
        priceCurrency: "TRY",
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/UsedCondition",
        availableAtOrFrom: {
          "@type": "Place",
          address: { "@type": "PostalAddress", addressLocality: "İzmir", addressCountry: "TR" },
        },
      },
    });
    expect(data).not.toHaveProperty("knownVehicleDamages");
  });

  it("fotoğraf yoksa video kapağı; açıklama yoksa özet metin; ağır hasar belirtilir; il ve kasa yoksa alan yok", () => {
    const data = buildVehicleJsonLd(
      { ...vehicle, photoUrls: [], description: null, hasHeavyDamage: true, city: null, bodyType: null },
      SITE,
    );
    expect(data.image).toEqual(["https://video/thumb.jpg"]);
    expect(data.description).toBe("85.000 km · Benzin · Otomatik. Ağır hasar kayıtlı. gözüyle'de videolu araç ilanı.");
    expect(data.knownVehicleDamages).toBe("Ağır hasar kaydı var");
    expect(data).not.toHaveProperty("bodyType");
    expect(data.offers).not.toHaveProperty("availableAtOrFrom");
  });

  it("yayında olmayan ilan: SoldOut; görsel hiç yoksa image alanı yok", () => {
    const data = buildVehicleJsonLd({ ...vehicle, status: "sold", photoUrls: [], videoThumbnailUrl: null }, SITE);
    expect((data.offers as Record<string, unknown>).availability).toBe("https://schema.org/SoldOut");
    expect(data).not.toHaveProperty("image");
  });
});

describe("serializeJsonLd", () => {
  it("satıcının metni betik bloğunu kapatamaz: < kaçırılır, JSON aynen geri okunur", () => {
    const data = buildVehicleJsonLd({ ...vehicle, description: '</script><script>alert("x")</script>' }, SITE);
    const html = serializeJsonLd(data);
    expect(html).not.toContain("</script>");
    expect(html).not.toContain("<");
    expect(JSON.parse(html)).toEqual(data);
  });
});
