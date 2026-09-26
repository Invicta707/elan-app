import { beforeEach, describe, expect, it, vi } from "vitest";

// Gerçek istemci ortam değişkeni ister ve ağa çıkar; RPC'yi taklit ediyoruz
vi.mock("./supabase", () => ({ supabase: { rpc: vi.fn() } }));

import { getSellerWhatsAppUrl, type FeedVehicle } from "./feed";
import { supabase } from "./supabase";

const vehicle: FeedVehicle = {
  id: "veh-1",
  brandName: "Porsche",
  modelName: "911 Carrera S",
  year: 2021,
  price: 3450000,
  currency: "TRY",
  mileageKm: 85000,
  fuelType: "benzin",
  transmission: "otomatik",
  city: "İstanbul",
  tramerAmount: 0,
  hasHeavyDamage: false,
  paintedPartsCount: 0,
  changedPartsCount: 0,
  hlsUrl: "https://video/veh-1.m3u8",
  thumbnailUrl: null,
};

const rpc = vi.mocked(supabase.rpc);

describe("getSellerWhatsAppUrl", () => {
  beforeEach(() => rpc.mockReset());

  it.each(["905445673430", "5445673430", "05445673430"])(
    "kayıtlı numara (%s) → normalize edilmiş wa.me bağlantısı ve hazır mesaj",
    async (stored) => {
      rpc.mockResolvedValue({ data: stored, error: null } as never);

      const url = await getSellerWhatsAppUrl(vehicle);

      expect(rpc).toHaveBeenCalledWith("get_seller_whatsapp", { p_vehicle_id: "veh-1" });
      expect(url).not.toBeNull();
      const parsed = new URL(url!);
      expect(parsed.origin + parsed.pathname).toBe("https://wa.me/905445673430");
      expect(parsed.searchParams.get("text")).toBe(
        "Merhaba, gözüyle'deki 2021 Porsche 911 Carrera S ilanınızla ilgileniyorum.",
      );
    },
  );

  it("numara yoksa ya da ilan yayında değilse (RPC null) null döner", async () => {
    rpc.mockResolvedValue({ data: null, error: null } as never);
    await expect(getSellerWhatsAppUrl(vehicle)).resolves.toBeNull();
  });

  it("geçersiz kayıtlı numarada bağlantı üretmez", async () => {
    rpc.mockResolvedValue({ data: "12345", error: null } as never);
    await expect(getSellerWhatsAppUrl(vehicle)).resolves.toBeNull();
  });

  it("RPC hatası yukarı iletilir", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("rpc failed") } as never);
    await expect(getSellerWhatsAppUrl(vehicle)).rejects.toThrow("rpc failed");
  });
});
