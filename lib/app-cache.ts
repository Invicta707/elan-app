// Ayarlar → Önbelleği temizle. UI'dan bağımsız; tarayıcı nesneleri parametre
// olarak alınır (testte taklit edilir).
//
// Temizlenenler: Cache Storage, service worker kayıtları, sessionStorage ve
// bellek içi önbellekler (katalog, takip / satıcı profilleri). Korunanlar:
// oturum (Supabase'in localStorage kaydı), misafir favorileri ve tercihler
// (localStorage). Ardından sayfa yeniden yüklenir: en güncel sürüm iner.

export type CacheEnvironment = {
  caches?: Pick<CacheStorage, "keys" | "delete">;
  serviceWorker?: { getRegistrations: () => Promise<readonly { unregister: () => Promise<boolean> }[]> };
  sessionStorage?: Pick<Storage, "clear">;
  /** Uygulamanın bellek içi önbelleklerini sıfırlar */
  clearMemory: () => void;
};

export type CacheClearResult = { cacheEntries: number; serviceWorkers: number };

export async function clearAppCache(env: CacheEnvironment): Promise<CacheClearResult> {
  let cacheEntries = 0;
  if (env.caches) {
    const keys = await env.caches.keys();
    await Promise.all(keys.map((key) => env.caches!.delete(key)));
    cacheEntries = keys.length;
  }

  let serviceWorkers = 0;
  if (env.serviceWorker) {
    const registrations = await env.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    serviceWorkers = registrations.length;
  }

  try {
    env.sessionStorage?.clear();
  } catch {
    // Depolama kapalı (gizli sekme): atlanır
  }
  env.clearMemory();
  return { cacheEntries, serviceWorkers };
}

/** Tarayıcının bu site için tuttuğu depolama (bilinmiyorsa null) */
export async function estimateStorageUsage(
  storage: { estimate?: () => Promise<{ usage?: number }> } | undefined,
): Promise<number | null> {
  try {
    const estimate = await storage?.estimate?.();
    return typeof estimate?.usage === "number" ? estimate.usage : null;
  } catch {
    return null;
  }
}

const decimal = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

/** 512 → "512 B", 2048 → "2 KB", 3_400_000 → "3,2 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  if (bytes < 1024 * 1024) return `${decimal.format(bytes / 1024)} KB`;
  return `${decimal.format(bytes / (1024 * 1024))} MB`;
}
