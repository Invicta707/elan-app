import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: { from: vi.fn() } }));

import {
  MAX_LOCAL_FAVORITES,
  addRemoteFavorite,
  fetchFavoriteVehicles,
  fetchRemoteFavoriteIds,
  parseStoredFavorites,
  removeRemoteFavorite,
  serializeFavorites,
  toFavoriteCard,
  withFavorite,
  withoutFavorites,
} from "./favorites";
import type { MyListingRow } from "./my-listings";
import { supabase } from "./supabase";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

function uuid(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

type QueryResult = { data?: unknown; error?: { code?: string; message?: string } | null };

// Supabase sorgu zincirinin taklidi: her çağrı kaydedilir, await edilince sonuç döner
function mockQuery(result: QueryResult) {
  const calls: [string, unknown[]][] = [];
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          const settled = Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
          return settled.then.bind(settled);
        }
        return (...args: unknown[]) => {
          calls.push([String(prop), args]);
          return builder;
        };
      },
    },
  );
  vi.mocked(supabase.from).mockReturnValueOnce(builder as never);
  return calls;
}

beforeEach(() => {
  vi.mocked(supabase.from).mockReset();
});

describe("parseStoredFavorites", () => {
  it("boş, bozuk ya da dizi olmayan değer boş liste", () => {
    expect(parseStoredFavorites(null)).toEqual([]);
    expect(parseStoredFavorites("")).toEqual([]);
    expect(parseStoredFavorites("{bozuk")).toEqual([]);
    expect(parseStoredFavorites('{"a":1}')).toEqual([]);
  });

  it("geçersiz id'ler ve tekrarlar atılır, sıra korunur", () => {
    expect(parseStoredFavorites(JSON.stringify([B, "x", 42, A, B, null]))).toEqual([B, A]);
  });

  it("üst sınırı aşan eski kayıtlar kesilir", () => {
    const many = Array.from({ length: MAX_LOCAL_FAVORITES + 5 }, (_, i) => uuid(i));
    expect(parseStoredFavorites(JSON.stringify(many))).toHaveLength(MAX_LOCAL_FAVORITES);
  });

  it("serializeFavorites ile gidiş-dönüş", () => {
    expect(parseStoredFavorites(serializeFavorites([A, B]))).toEqual([A, B]);
  });
});

describe("withFavorite / withoutFavorites", () => {
  it("ekleme başa yapılır, var olan başa taşınır", () => {
    expect(withFavorite([A, B], C)).toEqual([C, A, B]);
    expect(withFavorite([A, B], B)).toEqual([B, A]);
  });

  it("çıkarma birden çok id alır, listeyi değiştirmez", () => {
    const ids = [A, B, C];
    expect(withoutFavorites(ids, [A, C])).toEqual([B]);
    expect(ids).toEqual([A, B, C]);
  });
});

describe("fetchRemoteFavoriteIds", () => {
  it("kullanıcının 'save' kayıtlarını yeniden eskiye okur", async () => {
    const calls = mockQuery({ data: [{ vehicle_id: B }, { vehicle_id: A }, { vehicle_id: B }] });
    await expect(fetchRemoteFavoriteIds("user-1")).resolves.toEqual([B, A]);
    expect(supabase.from).toHaveBeenCalledWith("interactions");
    expect(calls).toEqual([
      ["select", ["vehicle_id"]],
      ["eq", ["user_id", "user-1"]],
      ["eq", ["type", "save"]],
      ["order", ["created_at", { ascending: false }]],
    ]);
  });

  it("hatayı iletir", async () => {
    mockQuery({ error: { code: "08006", message: "bağlantı yok" } });
    await expect(fetchRemoteFavoriteIds("user-1")).rejects.toMatchObject({ code: "08006" });
  });
});

describe("addRemoteFavorite", () => {
  it("'save' kaydı ekler", async () => {
    const calls = mockQuery({});
    await expect(addRemoteFavorite("user-1", A)).resolves.toBe("added");
    expect(calls).toEqual([["insert", [{ user_id: "user-1", vehicle_id: A, type: "save" }]]]);
  });

  it("zaten favorideyse (tekillik ihlali) başarılı sayılır", async () => {
    mockQuery({ error: { code: "23505" } });
    await expect(addRemoteFavorite("user-1", A)).resolves.toBe("added");
  });

  it("ilan silinmişse (yabancı anahtar ihlali) 'missing'", async () => {
    mockQuery({ error: { code: "23503" } });
    await expect(addRemoteFavorite("user-1", A)).resolves.toBe("missing");
  });

  it("diğer hataları iletir", async () => {
    mockQuery({ error: { code: "42501", message: "permission denied" } });
    await expect(addRemoteFavorite("user-1", A)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("removeRemoteFavorite", () => {
  it("sadece bu kullanıcının bu ilandaki 'save' kaydını siler", async () => {
    const calls = mockQuery({});
    await removeRemoteFavorite("user-1", A);
    expect(calls).toEqual([
      ["delete", []],
      ["eq", ["user_id", "user-1"]],
      ["eq", ["vehicle_id", A]],
      ["eq", ["type", "save"]],
    ]);
  });

  it("hatayı iletir", async () => {
    mockQuery({ error: { code: "08006" } });
    await expect(removeRemoteFavorite("user-1", A)).rejects.toMatchObject({ code: "08006" });
  });
});

const row = (id: string, overrides: Partial<MyListingRow> = {}): MyListingRow => ({
  id,
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
  ...overrides,
});

describe("toFavoriteCard", () => {
  it("grid kartının alanlarını eşler", () => {
    const card = toFavoriteCard(
      row(A, {
        images: [{ image_url: "https://x/cover.jpg", is_primary: true, display_order: 0 }],
        videos: [{ status: "ready", hls_url: "https://v/a.m3u8", thumbnail_url: "https://v/t.jpg" }],
      }),
    );
    expect(card).toEqual({
      id: A,
      brandName: "Porsche",
      modelName: "911 Carrera S",
      year: 2021,
      price: 3450000,
      currency: "TRY",
      mileageKm: 85000,
      city: "İstanbul",
      coverImageUrl: "https://x/cover.jpg",
      videoThumbnailUrl: null,
      hasPlayableVideo: true,
    });
  });

  it("fotoğraf yoksa video kapağı; RLS'in gizlediği ilişkiler sorun çıkarmaz", () => {
    expect(
      toFavoriteCard(row(A, { videos: [{ status: "ready", hls_url: "https://v/a.m3u8", thumbnail_url: "https://v/t.jpg" }] }))
        .coverImageUrl,
    ).toBe("https://v/t.jpg");
    expect(toFavoriteCard(row(A, { brand: null, model: null, images: null, videos: null }))).toMatchObject({
      brandName: "",
      modelName: "",
      coverImageUrl: null,
      hasPlayableVideo: false,
    });
  });
});

describe("fetchFavoriteVehicles", () => {
  it("sadece yayındakileri, verilen sırayla döner", async () => {
    // Veritabanı farklı sırada döner; C yayında değil (satır gelmez)
    const calls = mockQuery({ data: [row(A), row(B)] });
    const cards = await fetchFavoriteVehicles([B, C, A]);

    expect(cards.map((c) => c.id)).toEqual([B, A]);
    expect(supabase.from).toHaveBeenCalledWith("vehicles");
    expect(calls).toContainEqual(["in", ["id", [B, C, A]]]);
    expect(calls).toContainEqual(["eq", ["status", "active"]]);
  });

  it("geçersiz id'ler sorgulanmaz; liste boşsa istek atılmaz", async () => {
    await expect(fetchFavoriteVehicles(["x", ""])).resolves.toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("uzun listeler parça parça sorgulanır", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => uuid(i));
    const first = mockQuery({ data: [row(ids[0])] });
    const second = mockQuery({ data: [row(ids[60])] });
    const third = mockQuery({ data: [row(ids[119])] });

    const cards = await fetchFavoriteVehicles(ids);

    expect(supabase.from).toHaveBeenCalledTimes(3);
    const chunkOf = (calls: [string, unknown[]][]) => (calls.find(([m]) => m === "in")![1][1] as string[]).length;
    expect([chunkOf(first), chunkOf(second), chunkOf(third)]).toEqual([50, 50, 20]);
    expect(cards.map((c) => c.id)).toEqual([ids[0], ids[60], ids[119]]);
  });

  it("hatayı iletir", async () => {
    mockQuery({ error: { code: "08006" } });
    await expect(fetchFavoriteVehicles([A])).rejects.toMatchObject({ code: "08006" });
  });
});
