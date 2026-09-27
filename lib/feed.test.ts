import { beforeEach, describe, expect, it, vi } from "vitest";

// Gerçek istemci ortam değişkeni ister ve ağa çıkar; RPC'yi taklit ediyoruz
vi.mock("./supabase", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

import { fetchFeedPage, getSellerWhatsAppUrl, type FeedVehicle } from "./feed";
import { supabase } from "./supabase";

const vehicle: FeedVehicle = {
  id: "veh-1",
  sellerId: "seller-1",
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
  commentsCount: 0,
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

const feedRow = {
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
  comments_count: 12,
  brand: { name: "Fiat" },
  model: { name: "Egea" },
  videos: [{ hls_url: "https://video/9.m3u8", thumbnail_url: null, order_index: 0 }],
};

describe("fetchFeedPage", () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.mocked(supabase.from).mockReset();
  });

  it("Keşfet: vehicles tablosundan, satıcı kimliğiyle", async () => {
    const { proxy, calls } = queryChain({ data: [feedRow], error: null });
    vi.mocked(supabase.from).mockReturnValue(proxy as never);

    const page = await fetchFeedPage(null, 8);
    expect(supabase.from).toHaveBeenCalledWith("vehicles");
    expect(rpc).not.toHaveBeenCalled();
    expect(String(calls.find(([name]) => name === "select")?.[1])).toContain("seller_id");
    expect(calls).toContainEqual(["not", "videos.hls_url", "is", null]);
    expect(page.items[0]).toMatchObject({ id: "veh-9", sellerId: "seller-9", price: 990000, commentsCount: 12 });
    expect(String(calls.find(([name]) => name === "select")?.[1])).toContain("comments_count");
  });

  it("yorum sayısı yoksa (eski satır) 0", async () => {
    const { proxy } = queryChain({ data: [{ ...feedRow, comments_count: undefined }], error: null });
    vi.mocked(supabase.from).mockReturnValue(proxy as never);
    expect((await fetchFeedPage(null, 8)).items[0].commentsCount).toBe(0);
  });

  it("Takip Edilenler: following_feed RPC'si üstüne aynı süzgeç, sıralama ve sayfalama", async () => {
    const { proxy, calls } = queryChain({ data: [feedRow], error: null });
    rpc.mockReturnValue(proxy as never);

    const cursor = { createdAt: "2026-09-28T00:00:00+00:00", id: "veh-99" };
    const page = await fetchFeedPage(cursor, 8, "following");
    expect(rpc).toHaveBeenCalledWith("following_feed");
    expect(supabase.from).not.toHaveBeenCalled();
    const names = calls.map(([name]) => name);
    expect(names).toEqual(expect.arrayContaining(["select", "eq", "lte", "or", "order", "limit"]));
    expect(calls).toContainEqual(["eq", "status", "active"]);
    expect(calls).toContainEqual(["eq", "videos.status", "ready"]);
    // RPC'de gömülü "is" süzgeci PostgREST'te hata veriyor; gönderilmemeli
    expect(names).not.toContain("not");
    expect(page).toMatchObject({ hasMore: false, nextCursor: { id: "veh-9" } });
  });
});
