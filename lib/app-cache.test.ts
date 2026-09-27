import { describe, expect, it, vi } from "vitest";
import { clearAppCache, estimateStorageUsage, formatBytes } from "./app-cache";

describe("clearAppCache", () => {
  it("Cache Storage'ı ve service worker kayıtlarını siler, sessionStorage'ı ve bellek önbelleklerini temizler", async () => {
    const deleted: string[] = [];
    const unregister = vi.fn(async () => true);
    const clearSession = vi.fn();
    const clearMemory = vi.fn();

    const result = await clearAppCache({
      caches: {
        keys: async () => ["next-assets", "images"],
        delete: async (key: string) => {
          deleted.push(key);
          return true;
        },
      },
      serviceWorker: { getRegistrations: async () => [{ unregister }, { unregister }] },
      sessionStorage: { clear: clearSession },
      clearMemory,
    });

    expect(result).toEqual({ cacheEntries: 2, serviceWorkers: 2 });
    expect(deleted.sort()).toEqual(["images", "next-assets"]);
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(clearMemory).toHaveBeenCalledTimes(1);
  });

  it("API'leri olmayan tarayıcıda ve kapalı depolamada da çalışır; localStorage'a (oturum, favoriler) dokunmaz", async () => {
    const clearMemory = vi.fn();
    const result = await clearAppCache({
      sessionStorage: {
        clear: () => {
          throw new DOMException("denied", "SecurityError");
        },
      },
      clearMemory,
    });
    expect(result).toEqual({ cacheEntries: 0, serviceWorkers: 0 });
    expect(clearMemory).toHaveBeenCalledTimes(1);
    // Ortam nesnesinde localStorage yok: temizleme onu hiç görmez
  });
});

describe("estimateStorageUsage / formatBytes", () => {
  it("tarayıcının tahminini döner; yoksa ya da hata verirse null", async () => {
    expect(await estimateStorageUsage({ estimate: async () => ({ usage: 2048 }) })).toBe(2048);
    expect(await estimateStorageUsage(undefined)).toBeNull();
    expect(
      await estimateStorageUsage({
        estimate: async () => {
          throw new Error("no");
        },
      }),
    ).toBeNull();
  });

  it("okunaklı boyut", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.25 * 1024 * 1024)).toBe("3,3 MB");
  });
});
