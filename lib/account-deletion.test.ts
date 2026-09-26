import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAccount, requestAccountDeletion } from "./account-deletion";

type Fake = {
  vehicles?: { id: string; videos: { stream_uid: string | null }[] | null }[];
  files?: Record<string, { name: string }[]>;
  vehiclesError?: unknown;
  listError?: unknown;
  deleteError?: unknown;
  removeError?: unknown;
};

// Supabase'in bu akışta kullanılan parçalarının taklidi; çağrı sırası kaydedilir
function fakeSupabase(fake: Fake) {
  const order: string[] = [];
  const removed: string[] = [];
  const client = {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: async (column: string, value: string) => {
          order.push(`select ${table}(${columns}) ${column}=${value}`);
          return { data: fake.vehicles ?? [], error: fake.vehiclesError ?? null };
        },
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string) => {
          order.push(`list ${bucket}/${prefix}`);
          return { data: fake.files?.[prefix] ?? [], error: fake.listError ?? null };
        },
        remove: async (paths: string[]) => {
          order.push(`remove ${bucket}`);
          removed.push(...paths);
          return { data: [], error: fake.removeError ?? null };
        },
      }),
    },
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          order.push(`deleteUser ${id}`);
          return { data: {}, error: fake.deleteError ?? null };
        },
      },
    },
  };
  return { supabase: client as unknown as SupabaseClient, order, removed };
}

const SELLER = {
  vehicles: [
    { id: "veh-1", videos: [{ stream_uid: "cf-1" }] },
    { id: "veh-2", videos: [{ stream_uid: null }, { stream_uid: "cf-2" }] },
  ],
  files: { "veh-1": [{ name: "0.jpg" }, { name: "1.jpg" }], "veh-2": [{ name: "0.png" }] },
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deleteAccount", () => {
  it("önce dosyaları toplar, sonra hesabı siler, en son dosyaları ve videoları temizler", async () => {
    const { supabase, order, removed } = fakeSupabase(SELLER);
    const deleteStreamVideo = vi.fn(async (uid: string) => void order.push(`cloudflare ${uid}`));

    await expect(deleteAccount("user-1", { supabase, deleteStreamVideo })).resolves.toEqual({
      ok: true,
      vehicles: 2,
      photos: 3,
      videos: 2,
      cleanupFailures: 0,
    });
    expect(order).toEqual([
      "select vehicles(id, videos(stream_uid)) seller_id=user-1",
      "list vehicle-photos/veh-1",
      "list vehicle-photos/veh-2",
      "deleteUser user-1",
      "remove vehicle-photos",
      "cloudflare cf-1",
      "cloudflare cf-2",
    ]);
    expect(removed).toEqual(["veh-1/0.jpg", "veh-1/1.jpg", "veh-2/0.png"]);
  });

  it("ilanı olmayan kullanıcıda sadece hesap silinir", async () => {
    const { supabase, order } = fakeSupabase({});
    const deleteStreamVideo = vi.fn();
    await expect(deleteAccount("user-1", { supabase, deleteStreamVideo })).resolves.toMatchObject({
      ok: true,
      vehicles: 0,
    });
    expect(order).toEqual(["select vehicles(id, videos(stream_uid)) seller_id=user-1", "deleteUser user-1"]);
    expect(deleteStreamVideo).not.toHaveBeenCalled();
  });

  it("ilanlar ya da fotoğraflar okunamazsa hiçbir şey silinmez", async () => {
    for (const fake of [{ ...SELLER, vehiclesError: { code: "08006" } }, { ...SELLER, listError: { message: "x" } }]) {
      const { supabase, order } = fakeSupabase(fake);
      const deleteStreamVideo = vi.fn();
      await expect(deleteAccount("user-1", { supabase, deleteStreamVideo })).resolves.toEqual({
        ok: false,
        error: "lookup_failed",
      });
      expect(order.some((step) => step.startsWith("deleteUser") || step.startsWith("remove"))).toBe(false);
      expect(deleteStreamVideo).not.toHaveBeenCalled();
    }
  });

  it("hesap silinemezse dosyalara ve videolara dokunulmaz", async () => {
    const { supabase, removed } = fakeSupabase({ ...SELLER, deleteError: { message: "Database error" } });
    const deleteStreamVideo = vi.fn();
    await expect(deleteAccount("user-1", { supabase, deleteStreamVideo })).resolves.toEqual({
      ok: false,
      error: "delete_failed",
    });
    expect(removed).toEqual([]);
    expect(deleteStreamVideo).not.toHaveBeenCalled();
  });

  it("hesap silindikten sonraki temizlik hataları isteği düşürmez, sayılır", async () => {
    const { supabase } = fakeSupabase({ ...SELLER, removeError: { message: "storage down" } });
    const deleteStreamVideo = vi.fn(async (uid: string) => {
      if (uid === "cf-2") throw new Error("cloudflare 500");
    });
    await expect(deleteAccount("user-1", { supabase, deleteStreamVideo })).resolves.toMatchObject({
      ok: true,
      cleanupFailures: 3 + 1,
    });
  });
});

describe("requestAccountDeletion", () => {
  it("oturum anahtarı ve açık onayla istek atar", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(requestAccountDeletion("token-1", fetchImpl)).resolves.toEqual({ ok: true });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/user/delete");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer token-1");
    expect(JSON.parse(init?.body as string)).toEqual({ confirm: true });
  });

  it("sunucu mesajını iletir; ağ hatasında genel mesaj", async () => {
    const failed = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ error: { message: "Hesabını silmek için giriş yapmalısın." } }), { status: 401 }),
    );
    await expect(requestAccountDeletion("t", failed)).resolves.toEqual({
      ok: false,
      message: "Hesabını silmek için giriş yapmalısın.",
    });

    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(requestAccountDeletion("t", offline)).resolves.toMatchObject({ ok: false });
  });
});
