import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: { rpc: vi.fn() } }));

import { statusErrorMessage, toMyListing, updateListingStatus, type MyListingRow } from "./my-listings";
import { supabase } from "./supabase";

const baseRow: MyListingRow = {
  id: "veh-1",
  status: "active",
  year: 2021,
  price: "3450000",
  currency: "TRY",
  mileage_km: 85000,
  city: "İstanbul",
  created_at: "2026-09-24T15:50:24Z",
  brand: { name: "Porsche" },
  model: { name: "911 Carrera S" },
  images: [],
  videos: [],
};

describe("toMyListing", () => {
  it("alanları eşler, fiyatı sayıya çevirir", () => {
    expect(toMyListing(baseRow)).toMatchObject({
      id: "veh-1",
      title: "Porsche 911 Carrera S",
      price: 3450000,
      mileageKm: 85000,
      status: "active",
      coverUrl: null,
      hasPlayableVideo: false,
    });
  });

  it("kapak: is_primary fotoğraf, sonra sıraya göre ilk", () => {
    const row = {
      ...baseRow,
      images: [
        { image_url: "https://x/2.jpg", is_primary: false, display_order: 2 },
        { image_url: "https://x/1.jpg", is_primary: false, display_order: 1 },
        { image_url: "https://x/cover.jpg", is_primary: true, display_order: 5 },
      ],
    };
    expect(toMyListing(row).coverUrl).toBe("https://x/cover.jpg");
    expect(toMyListing({ ...row, images: row.images.slice(0, 2) }).coverUrl).toBe("https://x/1.jpg");
  });

  it("fotoğraf yoksa hazır videonun kapağı kullanılır", () => {
    const listing = toMyListing({
      ...baseRow,
      videos: [
        { status: "processing", hls_url: null, thumbnail_url: "https://v/processing.jpg" },
        { status: "ready", hls_url: "https://v/a.m3u8", thumbnail_url: "https://v/ready.jpg" },
      ],
    });
    expect(listing.coverUrl).toBe("https://v/ready.jpg");
    expect(listing.hasPlayableVideo).toBe(true);
  });

  it("RLS'in gizlediği ilişkiler (null) sorun çıkarmaz", () => {
    expect(toMyListing({ ...baseRow, images: null, videos: null })).toMatchObject({
      coverUrl: null,
      hasPlayableVideo: false,
    });
  });
});

describe("statusErrorMessage", () => {
  it.each([
    [{ code: "23514", message: "İlan yayınlanamadı: en az bir fotoğraf ya da işlenmiş bir video gerekli." },
      "İlan yayınlanamadı: en az bir fotoğraf ya da işlenmiş bir video gerekli."],
    [{ code: "P0002", message: "İlan bulunamadı." }, "İlan bulunamadı. Sayfayı yenileyip tekrar dene."],
    [{ code: "42501", message: "permission denied" }, "Bu işlem için giriş yapmalısın."],
    [{ code: "08006", message: "connection failure" }, "İlan durumu güncellenemedi. Bağlantını kontrol edip tekrar dene."],
  ])("%j", (error, expected) => {
    expect(statusErrorMessage(error)).toBe(expected);
  });
});

describe("updateListingStatus", () => {
  const rpc = vi.mocked(supabase.rpc);
  beforeEach(() => rpc.mockReset());

  it("set_vehicle_status'u ilan ve hedef durumla çağırır", async () => {
    rpc.mockResolvedValue({ data: "sold", error: null } as never);
    await expect(updateListingStatus("veh-1", "sold")).resolves.toBe("sold");
    expect(rpc).toHaveBeenCalledWith("set_vehicle_status", { p_vehicle_id: "veh-1", p_status: "sold" });
  });

  it("yayın şartı karşılanmazsa veritabanının mesajıyla hata fırlatır", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "İlan yayınlanamadı: en az bir fotoğraf ya da işlenmiş bir video gerekli." },
    } as never);
    await expect(updateListingStatus("veh-1", "active")).rejects.toThrow("en az bir fotoğraf");
  });

  it("başkasının ilanı: bulunamadı", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "İlan bulunamadı." } } as never);
    await expect(updateListingStatus("someone-else", "sold")).rejects.toThrow("İlan bulunamadı");
  });
});
