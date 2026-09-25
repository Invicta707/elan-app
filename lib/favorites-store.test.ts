import { beforeEach, describe, expect, it, vi } from "vitest";

// Store Supabase'e dokunmaz (API dışarıdan verilir); ./favorites'in içe aktarması için
vi.mock("./supabase", () => ({ supabase: {} }));

import { FAVORITES_STORAGE_KEY, type RemoteAddResult } from "./favorites";
import { createFavoritesStore, type FavoritesApi, type KeyValueStorage } from "./favorites-store";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";

function memoryStorage(initial: string[] | null = null) {
  const data = new Map<string, string>();
  if (initial) data.set(FAVORITES_STORAGE_KEY, JSON.stringify(initial));
  const storage: KeyValueStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
  return {
    storage,
    stored: (): string[] | null => {
      const raw = data.get(FAVORITES_STORAGE_KEY);
      return raw === undefined ? null : JSON.parse(raw);
    },
    set: (ids: string[]) => data.set(FAVORITES_STORAGE_KEY, JSON.stringify(ids)),
  };
}

function fakeApi(remote: string[] = []) {
  return {
    fetchIds: vi.fn<FavoritesApi["fetchIds"]>(async () => [...remote]),
    add: vi.fn<FavoritesApi["add"]>(async (): Promise<RemoteAddResult> => "added"),
    remove: vi.fn<FavoritesApi["remove"]>(async () => {}),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("misafir", () => {
  it("oturum bilinene kadar yükleniyor; cihazdaki liste hemen görünür", () => {
    const store = createFavoritesStore({ api: fakeApi(), storage: memoryStorage([A]).storage });
    expect(store.getSnapshot()).toEqual({ status: "loading", userId: null, ids: [A] });
  });

  it("ekleme/çıkarma cihaza yazılır, sunucuya gitmez", async () => {
    const api = fakeApi();
    const local = memoryStorage([A]);
    const store = createFavoritesStore({ api, storage: local.storage });
    await store.setUser(null);

    await expect(store.toggle(B)).resolves.toBe("added");
    expect(store.getSnapshot().ids).toEqual([B, A]);
    expect(local.stored()).toEqual([B, A]);

    await expect(store.toggle(A)).resolves.toBe("removed");
    await expect(store.toggle(B)).resolves.toBe("removed");
    expect(store.getSnapshot().ids).toEqual([]);
    expect(local.stored()).toBeNull();

    expect(api.add).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it("oturum bilinmeden yapılan dokunuş oturumu bekler", async () => {
    const local = memoryStorage();
    const store = createFavoritesStore({ api: fakeApi(), storage: local.storage });

    const pending = store.toggle(A);
    expect(store.getSnapshot().ids).toEqual([]);

    await store.setUser(null);
    await expect(pending).resolves.toBe("added");
    expect(local.stored()).toEqual([A]);
  });

  it("başka sekmedeki değişiklik alınır", async () => {
    const local = memoryStorage([A]);
    const store = createFavoritesStore({ api: fakeApi(), storage: local.storage });
    await store.setUser(null);

    local.set([C, A]);
    store.reloadFromStorage();
    expect(store.getSnapshot().ids).toEqual([C, A]);
  });

  it("localStorage kullanılamıyorsa liste bellekte yaşar", async () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    const store = createFavoritesStore({ api: fakeApi(), storage: broken });
    await store.setUser(null);
    await expect(store.toggle(A)).resolves.toBe("added");
    expect(store.getSnapshot().ids).toEqual([A]);
  });
});

describe("giriş yapınca", () => {
  it("hesaptaki liste yüklenir, cihazdakiler hesaba taşınıp cihazdan silinir", async () => {
    const api = fakeApi([B, C]);
    const local = memoryStorage([A, B]);
    const store = createFavoritesStore({ api, storage: local.storage });

    await store.setUser("user-1");

    expect(api.fetchIds).toHaveBeenCalledWith("user-1");
    // B zaten hesapta: sadece A yüklenir
    expect(api.add.mock.calls).toEqual([["user-1", A]]);
    expect(store.getSnapshot()).toEqual({ status: "ready", userId: "user-1", ids: [A, B, C] });
    expect(local.stored()).toBeNull();
  });

  it("silinmiş ilan düşer; yüklenemeyen cihazda bekler ve listede görünür", async () => {
    const api = fakeApi([C]);
    api.add.mockImplementation(async (_user, id) => {
      if (id === A) return "missing";
      if (id === B) throw new Error("ağ hatası");
      return "added";
    });
    const local = memoryStorage([A, B]);
    const store = createFavoritesStore({ api, storage: local.storage });

    await store.setUser("user-1");

    expect(store.getSnapshot().ids).toEqual([B, C]);
    expect(local.stored()).toEqual([B]);
  });

  it("aynı kullanıcıyla tekrar çağrı (token yenilenmesi) listeyi yeniden yüklemez", async () => {
    const api = fakeApi([A]);
    const store = createFavoritesStore({ api, storage: memoryStorage().storage });
    await store.setUser("user-1");
    await store.setUser("user-1");
    expect(api.fetchIds).toHaveBeenCalledTimes(1);
  });

  it("liste yüklenemezse hata; tekrar denenebilir", async () => {
    const api = fakeApi([A]);
    api.fetchIds.mockRejectedValueOnce(new Error("ağ hatası"));
    const store = createFavoritesStore({ api, storage: memoryStorage().storage });

    await store.setUser("user-1");
    expect(store.getSnapshot().status).toBe("error");

    await store.retry();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", ids: [A] });
  });

  it("yükleme sürerken çıkış yapılırsa geç gelen yanıt misafir listesini ezmez", async () => {
    const api = fakeApi();
    const slow = deferred<string[]>();
    api.fetchIds.mockReturnValueOnce(slow.promise);
    const store = createFavoritesStore({ api, storage: memoryStorage().storage });

    const syncing = store.setUser("user-1");
    await store.setUser(null);
    slow.resolve([A, B]);
    await syncing;

    expect(store.getSnapshot()).toEqual({ status: "ready", userId: null, ids: [] });
  });
});

describe("giriş yapmışken", () => {
  async function signedIn(remote: string[], local: string[] | null = null) {
    const api = fakeApi(remote);
    const storage = memoryStorage(local);
    const store = createFavoritesStore({ api, storage: storage.storage });
    await store.setUser("user-1");
    api.add.mockClear();
    return { api, storage, store };
  }

  it("ekleme ve çıkarma hesaba yazılır, cihaza yazılmaz", async () => {
    const { api, storage, store } = await signedIn([A]);

    await expect(store.toggle(B)).resolves.toBe("added");
    expect(api.add).toHaveBeenCalledWith("user-1", B);
    expect(store.getSnapshot().ids).toEqual([B, A]);

    await expect(store.toggle(A)).resolves.toBe("removed");
    expect(api.remove).toHaveBeenCalledWith("user-1", A);
    expect(store.getSnapshot().ids).toEqual([B]);

    expect(storage.stored()).toBeNull();
  });

  it("değişiklik hemen görünür (iyimser), istek bitmeden", async () => {
    const { api, store } = await signedIn([]);
    const slow = deferred<RemoteAddResult>();
    api.add.mockReturnValueOnce(slow.promise);

    const pending = store.toggle(A);
    await Promise.resolve();
    expect(store.getSnapshot().ids).toEqual([A]);

    slow.resolve("added");
    await expect(pending).resolves.toBe("added");
  });

  it("kaydedilemezse değişiklik geri alınır", async () => {
    const { api, store } = await signedIn([A]);
    api.add.mockRejectedValueOnce(new Error("ağ hatası"));
    api.remove.mockRejectedValueOnce(new Error("ağ hatası"));

    await expect(store.toggle(B)).resolves.toBe("failed");
    expect(store.getSnapshot().ids).toEqual([A]);

    await expect(store.toggle(A)).resolves.toBe("failed");
    expect(store.getSnapshot().ids).toEqual([A]);
  });

  it("ilan silinmişse eklenmez", async () => {
    const { api, store } = await signedIn([]);
    api.add.mockResolvedValueOnce("missing");
    await expect(store.toggle(A)).resolves.toBe("missing");
    expect(store.getSnapshot().ids).toEqual([]);
  });

  it("eski bir isteğin hatası sonraki işlemi geri almaz", async () => {
    const { api, store } = await signedIn([]);
    const slowAdd = deferred<RemoteAddResult>();
    api.add.mockReturnValueOnce(slowAdd.promise);

    const add = store.toggle(A);
    await Promise.resolve();
    await store.toggle(A); // hemen geri çıkarıldı
    slowAdd.reject(new Error("ağ hatası"));
    await add;

    expect(store.getSnapshot().ids).toEqual([]);
  });

  it("cihazda bekleyen favori çıkarılınca cihazdan da silinir", async () => {
    const api = fakeApi([]);
    api.add.mockRejectedValue(new Error("ağ hatası"));
    const local = memoryStorage([A]);
    const store = createFavoritesStore({ api, storage: local.storage });
    await store.setUser("user-1");
    expect(store.getSnapshot().ids).toEqual([A]);

    await store.toggle(A);
    expect(local.stored()).toBeNull();
    expect(store.getSnapshot().ids).toEqual([]);
  });

  it("çıkış yapınca hesabın listesi görünmez", async () => {
    const { store } = await signedIn([A, B]);
    await store.setUser(null);
    expect(store.getSnapshot()).toEqual({ status: "ready", userId: null, ids: [] });
  });

  it("başka sekmedeki misafir listesi hesap listesini değiştirmez", async () => {
    const { storage, store } = await signedIn([A]);
    storage.set([D]);
    store.reloadFromStorage();
    expect(store.getSnapshot().ids).toEqual([A]);
  });
});

describe("removeMany", () => {
  it("misafirken cihazdan siler", async () => {
    const local = memoryStorage([A, B, C]);
    const store = createFavoritesStore({ api: fakeApi(), storage: local.storage });
    await store.setUser(null);

    await store.removeMany([A, C]);
    expect(store.getSnapshot().ids).toEqual([B]);
    expect(local.stored()).toEqual([B]);
  });

  it("giriş yapmışken her birini hesaptan siler; hatalar akışı durdurmaz", async () => {
    const api = fakeApi([A, B, C]);
    api.remove.mockRejectedValueOnce(new Error("ağ hatası"));
    const store = createFavoritesStore({ api, storage: memoryStorage().storage });
    await store.setUser("user-1");

    await store.removeMany([A, C]);
    expect(api.remove.mock.calls).toEqual([
      ["user-1", A],
      ["user-1", C],
    ]);
    expect(store.getSnapshot().ids).toEqual([B]);
  });
});

describe("abonelik", () => {
  it("her değişiklikte dinleyiciler çağrılır; abonelik bırakılabilir", async () => {
    const store = createFavoritesStore({ api: fakeApi(), storage: memoryStorage().storage });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    await store.setUser(null);
    await store.toggle(A);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await store.toggle(A);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("değişmeyen durumda aynı nesne döner (useSyncExternalStore için)", async () => {
    const store = createFavoritesStore({ api: fakeApi(), storage: memoryStorage().storage });
    await store.setUser(null);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });
});
