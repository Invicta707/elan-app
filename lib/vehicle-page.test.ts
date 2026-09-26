import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "./supabase";
import {
  buildVehicleDescription,
  buildVehicleShareText,
  buildVehicleTitle,
  fetchVehiclePage,
  toVehiclePage,
  vehicleOgImage,
  type VehiclePageRow,
} from "./vehicle-page";

const VEHICLE_ID = "151ebbc0-627b-4ba4-a03b-6c4394ecda68";

const row: VehiclePageRow = {
  id: VEHICLE_ID,
  status: "active",
  year: 2021,
  price: "3450000",
  currency: "TRY",
  mileage_km: 85000,
  fuel_type: "benzin",
  transmission: "otomatik",
  body_type: "hatchback",
  city: "İstanbul",
  has_heavy_damage: false,
  description: "  Bakımları yapıldı.  ",
  brand: { name: "Porsche" },
  model: { name: "911 Carrera S" },
  images: [
    { image_url: "https://img/2.jpg", is_primary: false, display_order: 2 },
    { image_url: "https://img/cover.jpg", is_primary: true, display_order: 1 },
    { image_url: "https://img/0.jpg", is_primary: false, display_order: 0 },
  ],
  videos: [{ status: "ready", hls_url: "https://v/a.m3u8", thumbnail_url: "https://v/thumb.jpg" }],
};

describe("toVehiclePage", () => {
  it("satırı sayfa verisine çevirir, kapağı başa alır", () => {
    expect(toVehiclePage(row)).toEqual({
      id: VEHICLE_ID,
      status: "active",
      brandName: "Porsche",
      modelName: "911 Carrera S",
      year: 2021,
      mileageKm: 85000,
      price: 3450000,
      currency: "TRY",
      fuelType: "benzin",
      transmission: "otomatik",
      bodyType: "hatchback",
      city: "İstanbul",
      hasHeavyDamage: false,
      description: "Bakımları yapıldı.",
      photoUrls: ["https://img/cover.jpg", "https://img/0.jpg", "https://img/2.jpg"],
      videoThumbnailUrl: "https://v/thumb.jpg",
      hasPlayableVideo: true,
    });
  });

  it("gizli ya da boş ilişkiler (null) sorun çıkarmaz", () => {
    expect(toVehiclePage({ ...row, images: null, videos: null, description: "  " })).toMatchObject({
      photoUrls: [],
      videoThumbnailUrl: null,
      hasPlayableVideo: false,
      description: null,
    });
  });
});

describe("SEO ve paylaşım metinleri", () => {
  const vehicle = toVehiclePage(row);

  it("başlık: [Yıl] [Marka] [Model] - [Fiyat]", () => {
    expect(buildVehicleTitle(vehicle)).toBe("2021 Porsche 911 Carrera S - ₺3.450.000");
  });

  it("açıklama: km, yakıt, vites ve il", () => {
    expect(buildVehicleDescription(vehicle)).toBe(
      "85.000 km · Benzin · Otomatik · İstanbul. gözüyle'de videolu araç ilanı.",
    );
  });

  it("şehir yoksa atlanır, ağır hasar belirtilir", () => {
    expect(buildVehicleDescription({ ...vehicle, city: null, hasHeavyDamage: true })).toBe(
      "85.000 km · Benzin · Otomatik. Ağır hasar kayıtlı. gözüyle'de videolu araç ilanı.",
    );
  });

  it("paylaşım metni", () => {
    expect(buildVehicleShareText(vehicle)).toBe("gözüyle'de 2021 Porsche 911 Carrera S - ₺3.450.000");
  });

  it("OG görseli: kapak fotoğrafı, yoksa video kapağı, o da yoksa yok", () => {
    expect(vehicleOgImage(vehicle)).toBe("https://img/cover.jpg");
    expect(vehicleOgImage({ photoUrls: [], videoThumbnailUrl: "https://v/thumb.jpg" })).toBe("https://v/thumb.jpg");
    expect(vehicleOgImage({ photoUrls: [], videoThumbnailUrl: null })).toBeNull();
  });
});

describe("fetchVehiclePage", () => {
  const from = vi.mocked(supabase.from);
  let result: { data: unknown; error: unknown };
  const eq = vi.fn();

  beforeEach(() => {
    from.mockReset();
    eq.mockReset();
    const builder = {
      select: () => builder,
      eq: (...args: unknown[]) => {
        eq(...args);
        return builder;
      },
      maybeSingle: () => Promise.resolve(result),
    };
    from.mockReturnValue(builder as never);
  });

  it("geçersiz id'de sorgu atmadan null döner", async () => {
    await expect(fetchVehiclePage("../etc/passwd")).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("ilanı id ile ister ve eşler", async () => {
    result = { data: row, error: null };
    const vehicle = await fetchVehiclePage(VEHICLE_ID);
    expect(from).toHaveBeenCalledWith("vehicles");
    expect(eq).toHaveBeenCalledWith("id", VEHICLE_ID);
    expect(vehicle?.photoUrls[0]).toBe("https://img/cover.jpg");
  });

  it("bulunamazsa null, hata olursa fırlatır", async () => {
    result = { data: null, error: null };
    await expect(fetchVehiclePage(VEHICLE_ID)).resolves.toBeNull();
    result = { data: null, error: new Error("db down") };
    await expect(fetchVehiclePage(VEHICLE_ID)).rejects.toThrow("db down");
  });
});
