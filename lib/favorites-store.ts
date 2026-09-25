import {
  FAVORITES_STORAGE_KEY,
  parseStoredFavorites,
  serializeFavorites,
  uniqueIds,
  withFavorite,
  withoutFavorites,
  type RemoteAddResult,
} from "./favorites";

// Favori listesinin istemcideki tek kaynağı. React'ten ve tarayıcıdan
// bağımsız: localStorage, Supabase ve oturum bilgisi dışarıdan verilir
// (testlerde taklit edilir; lib/use-favorites.ts tarayıcıya bağlar).
//
// Misafir: liste cihazda (localStorage).
// Giriş yapınca: hesaptaki liste yüklenir, cihazdaki favoriler hesaba taşınır
// ve cihazdan silinir. Hesaba yüklenemeyenler cihazda bekler, listede görünür
// ve bir sonraki girişte tekrar denenir. Çıkış yapınca liste yine cihazdakidir
// (taşındığı için genelde boş): ortak cihazda hesabın favorileri görünmez.

export type FavoritesStatus = "loading" | "ready" | "error";

export type FavoritesState = {
  /** loading: oturum ya da hesaptaki liste henüz bilinmiyor; error: hesaptaki liste yüklenemedi */
  status: FavoritesStatus;
  /** Giriş yapmış kullanıcı; null = misafir */
  userId: string | null;
  /** Favorideki ilan id'leri, en son eklenen başta */
  ids: readonly string[];
};

/** missing: ilan artık yok; failed: kaydedilemedi (bağlantı vb.), değişiklik geri alındı */
export type ToggleOutcome = "added" | "removed" | "missing" | "failed";

export type FavoritesApi = {
  fetchIds(userId: string): Promise<string[]>;
  add(userId: string, vehicleId: string): Promise<RemoteAddResult>;
  remove(userId: string, vehicleId: string): Promise<void>;
};

export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type FavoritesStore = ReturnType<typeof createFavoritesStore>;

export function createFavoritesStore({
  api,
  storage,
}: {
  api: FavoritesApi;
  /** null: localStorage kullanılamıyor (ör. engellenmiş); liste sadece bellekte */
  storage: KeyValueStorage | null;
}) {
  const listeners = new Set<() => void>();
  let state: FavoritesState = { status: "loading", userId: null, ids: readLocal() };
  // undefined: oturum henüz bilinmiyor
  let currentUser: string | null | undefined;
  // Oturum her değiştiğinde artar: eski oturumun geç gelen yanıtı yenisini ezmesin
  let generation = 0;
  // İlan başına son işlemin sırası: eski bir isteğin hatası yenisini geri almasın
  const latestOp = new Map<string, number>();
  let opCounter = 0;

  function readLocal(): string[] {
    try {
      return parseStoredFavorites(storage?.getItem(FAVORITES_STORAGE_KEY) ?? null);
    } catch {
      return [];
    }
  }

  function writeLocal(ids: readonly string[]) {
    try {
      if (ids.length > 0) storage?.setItem(FAVORITES_STORAGE_KEY, serializeFavorites(ids));
      else storage?.removeItem(FAVORITES_STORAGE_KEY);
    } catch {
      // Kota dolu ya da depolama engelli: liste bu oturumda bellekte yaşar
    }
  }

  function setState(next: Partial<FavoritesState>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function whenSettled(): Promise<void> {
    if (state.status !== "loading") return Promise.resolve();
    return new Promise((resolve) => {
      const unsubscribe = subscribe(() => {
        if (state.status === "loading") return;
        unsubscribe();
        resolve();
      });
    });
  }

  async function sync(userId: string, gen: number) {
    let remote: string[];
    try {
      remote = await api.fetchIds(userId);
    } catch (error) {
      console.error("Favoriler yüklenemedi:", error);
      if (gen === generation) setState({ status: "error" });
      return;
    }
    if (gen !== generation) return;

    const pending = readLocal().filter((id) => !remote.includes(id));
    const results = await Promise.allSettled(pending.map((id) => api.add(userId, id)));
    if (gen !== generation) return;

    const uploaded: string[] = [];
    const failed: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "rejected") failed.push(pending[index]);
      else if (result.value === "added") uploaded.push(pending[index]);
      // "missing": ilan silinmiş, cihazdan da düşer
    });

    writeLocal(failed);
    setState({ status: "ready", ids: uniqueIds([...uploaded, ...failed, ...remote]) });
  }

  /** Oturum değişince çağrılır (ilk oturum bilgisi dahil). Aynı kullanıcıyla tekrar çağrı etkisizdir. */
  async function setUser(userId: string | null): Promise<void> {
    if (userId === currentUser) return;
    currentUser = userId;
    const gen = ++generation;

    if (userId === null) {
      setState({ status: "ready", userId: null, ids: readLocal() });
      return;
    }
    setState({ status: "loading", userId, ids: readLocal() });
    await sync(userId, gen);
  }

  async function retry(): Promise<void> {
    if (state.userId === null || state.status !== "error") return;
    const gen = ++generation;
    setState({ status: "loading" });
    await sync(state.userId, gen);
  }

  async function toggle(vehicleId: string): Promise<ToggleOutcome> {
    // Oturum ya da hesaptaki liste gelmeden dokunulduysa önce onları bekle:
    // hangi listeye (cihaz/hesap) yazılacağı ve ilanın favoride olup olmadığı o zaman belli
    await whenSettled();

    const adding = !state.ids.includes(vehicleId);
    const opId = ++opCounter;
    latestOp.set(vehicleId, opId);
    setState({ ids: adding ? withFavorite(state.ids, vehicleId) : withoutFavorites(state.ids, [vehicleId]) });

    const userId = state.userId;
    if (userId === null) {
      writeLocal(state.ids);
      return adding ? "added" : "removed";
    }

    // Hesaba yüklenememiş, cihazda bekleyen kopyası da gitsin
    if (!adding) writeLocal(withoutFavorites(readLocal(), [vehicleId]));

    const gen = generation;
    const revert = () => {
      if (gen !== generation || latestOp.get(vehicleId) !== opId) return;
      setState({
        ids: adding ? withoutFavorites(state.ids, [vehicleId]) : withFavorite(state.ids, vehicleId),
      });
    };

    try {
      if (!adding) {
        await api.remove(userId, vehicleId);
        return "removed";
      }
      if ((await api.add(userId, vehicleId)) === "missing") {
        revert();
        return "missing";
      }
      return "added";
    } catch (error) {
      console.error("Favori güncellenemedi:", error);
      revert();
      return "failed";
    }
  }

  /** Birden çok ilanı listeden çıkarır (ör. artık yayında olmayanlar). Hatalar yok sayılır. */
  async function removeMany(vehicleIds: readonly string[]): Promise<void> {
    await whenSettled();
    for (const id of vehicleIds) latestOp.set(id, ++opCounter);
    setState({ ids: withoutFavorites(state.ids, vehicleIds) });
    writeLocal(withoutFavorites(readLocal(), vehicleIds));

    const userId = state.userId;
    if (userId === null) return;
    // Silinemeyenler bir sonraki yüklemede listeye geri gelir; kullanıcıyı durdurmaya değmez
    await Promise.allSettled(vehicleIds.map((id) => api.remove(userId, id)));
  }

  /** Başka sekmede değişen cihaz listesini alır; hesap listesi etkilenmez. */
  function reloadFromStorage() {
    if (state.userId === null && state.status === "ready") setState({ ids: readLocal() });
  }

  return {
    subscribe,
    getSnapshot: (): FavoritesState => state,
    setUser,
    retry,
    toggle,
    removeMany,
    reloadFromStorage,
  };
}
