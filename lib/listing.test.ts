import { describe, expect, it } from "vitest";
import {
  MAX_PHOTO_BYTES,
  buildListingRecords,
  buildVehicleImageRow,
  photoRejection,
  photoStoragePath,
  validateListingDraft,
  type ListingDraft,
} from "./listing";

const NOW = new Date("2026-09-25T12:00:00Z");

const validDraft: ListingDraft = {
  brandId: "brand-1",
  modelId: "model-1",
  year: "2019",
  mileageKm: "85000",
  price: "750000",
  city: "İstanbul",
  bodyType: "sedan",
  fuelType: "dizel",
  transmission: "otomatik",
  damageStatus: "none",
  description: "Bakımları yapıldı.",
  whatsapp: "5445673430",
};

describe("validateListingDraft", () => {
  it("geçerli taslakta hata yok", () => {
    expect(validateListingDraft(validDraft, NOW)).toBeNull();
  });

  it.each<[string, Partial<ListingDraft>, string]>([
    ["marka yok", { brandId: "" }, "Marka ve model seçmelisin."],
    ["model yok", { modelId: "" }, "Marka ve model seçmelisin."],
    ["yıl boş", { year: "" }, "Geçerli bir yıl gir."],
    ["yıl çok eski", { year: "1969" }, "Geçerli bir yıl gir."],
    ["yıl gelecekte", { year: "2028" }, "Geçerli bir yıl gir."],
    ["kilometre yok", { mileageKm: "" }, "Kilometreyi gir."],
    ["fiyat yok", { price: "" }, "Fiyatı gir."],
    ["şehir sadece boşluk", { city: "   " }, "Şehir seç ya da yaz."],
    ["kasa tipi yok", { bodyType: "" }, "Kasa tipi seç."],
    ["yakıt türü yok", { fuelType: "" }, "Yakıt türü seç."],
    ["vites yok", { transmission: "" }, "Vites tipi seç."],
    ["numara geçersiz", { whatsapp: "12345" }, "Geçerli bir WhatsApp numarası gir."],
  ])("%s", (_name, change, message) => {
    expect(validateListingDraft({ ...validDraft, ...change }, NOW)).toBe(message);
  });

  it("gelecek yılın modeli kabul edilir", () => {
    expect(validateListingDraft({ ...validDraft, year: "2027" }, NOW)).toBeNull();
  });
});

describe("buildListingRecords", () => {
  it("profil ve ilan kayıtlarını veritabanı kolonlarıyla hazırlar", () => {
    const records = buildListingRecords("user-1", {
      ...validDraft,
      whatsapp: "0544 567 34 30",
      mileageKm: "85.000",
      price: "1.250.000",
      city: "  İstanbul ",
      description: "  Bakımları yapıldı.  ",
      damageStatus: "heavy",
    });

    expect(records).toEqual({
      profile: { id: "user-1", whatsapp_number: "905445673430" },
      vehicle: {
        seller_id: "user-1",
        brand_id: "brand-1",
        model_id: "model-1",
        year: 2019,
        mileage_km: 85000,
        price: 1250000,
        currency: "TRY",
        city: "İstanbul",
        body_type: "sedan",
        fuel_type: "dizel",
        transmission: "otomatik",
        has_heavy_damage: true,
        description: "Bakımları yapıldı.",
        status: "pending_video",
      },
    });
  });

  it("boş açıklama null olarak yazılır", () => {
    expect(buildListingRecords("user-1", { ...validDraft, description: "   " }).vehicle.description).toBeNull();
  });

  it("zorunlu kolonların (fuel_type, transmission, body_type) hepsi dolu", () => {
    const { vehicle } = buildListingRecords("user-1", validDraft);
    for (const column of ["fuel_type", "transmission", "body_type", "city", "status"] as const) {
      expect(vehicle[column]).toBeTruthy();
    }
  });

  it("geçersiz taslakta doğrulama mesajıyla hata fırlatır", () => {
    expect(() => buildListingRecords("user-1", { ...validDraft, whatsapp: "" })).toThrow(
      "Geçerli bir WhatsApp numarası gir.",
    );
    expect(() => buildListingRecords("user-1", { ...validDraft, bodyType: "" })).toThrow("Kasa tipi seç.");
  });
});

describe("photoRejection", () => {
  it.each(["image/jpeg", "image/png", "image/webp", "IMAGE/JPEG"])("%s kabul edilir", (type) => {
    expect(photoRejection({ type, size: MAX_PHOTO_BYTES })).toBeNull();
  });

  it.each(["image/heic", "image/heif", "image/gif", "image/svg+xml", "image/avif", "text/html", ""])(
    "%s reddedilir",
    (type) => {
      expect(photoRejection({ type, size: 1000 })).toBe("Fotoğraflar JPEG, PNG ya da WebP biçiminde olmalı.");
    },
  );

  it("10 MB'ın üstü reddedilir", () => {
    expect(photoRejection({ type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 })).toBe(
      "Fotoğraflar en fazla 10 MB olabilir.",
    );
  });
});

describe("fotoğraf kayıtları", () => {
  it("depolama anahtarı dosya adından bağımsız, sadece ASCII", () => {
    expect(photoStoragePath("veh-1", 0, "image/jpeg")).toBe("veh-1/0.jpeg");
    expect(photoStoragePath("veh-1", 3, "image/PNG")).toBe("veh-1/3.png");
    expect(photoStoragePath("veh-1", 1, "image/heic")).toBe("veh-1/1.heic");
    expect(photoStoragePath("veh-1", 2, "")).toBe("veh-1/2.jpg");
    expect(photoStoragePath("veh-1", 4, "image/svg+xml")).toMatch(/^[\w-]+\/\d+\.[a-z0-9]+$/);
  });

  it("ilk fotoğraf kapak, sıra korunur", () => {
    expect(buildVehicleImageRow("veh-1", "https://x/0.jpeg", 0)).toEqual({
      vehicle_id: "veh-1",
      image_url: "https://x/0.jpeg",
      display_order: 0,
      is_primary: true,
    });
    expect(buildVehicleImageRow("veh-1", "https://x/2.jpeg", 2)).toMatchObject({
      display_order: 2,
      is_primary: false,
    });
  });
});
