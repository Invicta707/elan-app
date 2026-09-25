"use client";

import { useSyncExternalStore } from "react";
import {
  FAVORITES_STORAGE_KEY,
  addRemoteFavorite,
  fetchRemoteFavoriteIds,
  removeRemoteFavorite,
} from "./favorites";
import {
  createFavoritesStore,
  type FavoritesState,
  type FavoritesStore,
  type ToggleOutcome,
} from "./favorites-store";
import { supabase } from "./supabase";

// Favori listesinin tarayıcıdaki tek örneği: akıştaki her kart, detay çekmecesi,
// ilan sayfası ve favoriler sayfası aynı listeyi görür. İlk kullanımda kurulur
// ve sayfa boyunca yaşar.

// Sunucuda localStorage yok: HTML boş listeyle çizilir, liste hidrasyondan
// sonra gelir (useSyncExternalStore bunu hidrasyon hatası olmadan yapar)
const SERVER_STATE: FavoritesState = { status: "loading", userId: null, ids: [] };

let store: FavoritesStore | null = null;

function getStore(): FavoritesStore {
  if (store) return store;

  const created = createFavoritesStore({
    api: { fetchIds: fetchRemoteFavoriteIds, add: addRemoteFavorite, remove: removeRemoteFavorite },
    storage: browserStorage(),
  });
  store = created;

  // İlk oturum bilgisi (INITIAL_SESSION) dahil her değişiklik buraya gelir.
  // Supabase bu geri çağırmanın içinde başka Supabase isteği yapılmamasını
  // söylüyor (kilitlenebilir): liste işlemleri bir sonraki tura ertelenir.
  supabase.auth.onAuthStateChange((_event, session) => {
    const userId = session?.user.id ?? null;
    window.setTimeout(() => void created.setUser(userId), 0);
  });

  // Misafirken başka sekmede eklenen/çıkarılan favoriler
  window.addEventListener("storage", (event) => {
    if (event.key === FAVORITES_STORAGE_KEY || event.key === null) created.reloadFromStorage();
  });

  return created;
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Bazı gizli pencere / engellenmiş çerez ayarlarında erişim hata verir
    return null;
  }
}

function subscribe(listener: () => void) {
  return getStore().subscribe(listener);
}

function getSnapshot() {
  return getStore().getSnapshot();
}

function getServerSnapshot() {
  return SERVER_STATE;
}

export function useFavorites(): FavoritesState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function toggleFavorite(vehicleId: string): Promise<ToggleOutcome> {
  return getStore().toggle(vehicleId);
}

export function removeFavorites(vehicleIds: readonly string[]): Promise<void> {
  return getStore().removeMany(vehicleIds);
}

export function retryFavorites(): Promise<void> {
  return getStore().retry();
}
