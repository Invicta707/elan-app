"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { useSupabaseSession } from "./auth";
import { fetchSellerProfiles, followErrorMessage, followUser, unfollowUser, type SellerProfile } from "./follows";
import { supabase } from "./supabase";
import { adjustMyFollowingCount } from "./use-my-profile";

// Takip durumu ve satıcı kısa profilleri için tek istemci deposu: aynı
// satıcının akıştaki bütün kartları, ilan sayfası ve profil sayfası aynı
// durumu gösterir. Takip et / bırak iyimserdir: arayüz hemen değişir, sunucu
// reddederse geri alınır. Depo, oturumdaki kullanıcıya bağlıdır; kullanıcı
// değişince (çıkış, başka hesap) sıfırlanır.

type FollowEntry = {
  following: boolean;
  /** Takipçi sayısı biliniyorsa (profil sayfası) iyimser olarak güncellenir */
  followers: number | null;
  pending: boolean;
  /** Bu oturumda kullanıcı değiştirdi: eski sunucu verisi üstüne yazamaz */
  dirty: boolean;
};

type Store = {
  viewerId: string | null;
  follows: ReadonlyMap<string, FollowEntry>;
  sellers: ReadonlyMap<string, SellerProfile | null>;
  /** Başarılı her takip değişikliğinde artar: "Takip Edilenler" akışı yenilenir */
  version: number;
};

let store: Store = { viewerId: null, follows: new Map(), sellers: new Map(), version: 0 };
const listeners = new Set<() => void>();

function commit(next: Partial<Store>) {
  store = { ...store, ...next };
  listeners.forEach((listener) => listener());
}

function forViewer(viewerId: string | null) {
  if (store.viewerId !== viewerId) {
    commit({ viewerId, follows: new Map(), sellers: new Map(), version: store.version + 1 });
  }
}

function writeFollow(targetId: string, entry: FollowEntry) {
  commit({ follows: new Map(store.follows).set(targetId, entry) });
}

/** Deponun o anki takip kaydı (testler ve hata ayıklama için) */
export function getFollowEntry(viewerId: string | null, targetId: string): Readonly<FollowEntry> | undefined {
  return store.viewerId === viewerId ? store.follows.get(targetId) : undefined;
}

/** Sunucudan gelen durumu kaydeder; kullanıcının bu oturumda değiştirdiği durumu ezmez */
export function seedFollowState(viewerId: string | null, targetId: string, following: boolean, followers: number | null = null) {
  forViewer(viewerId);
  const current = store.follows.get(targetId);
  if (current && (current.dirty || current.pending)) {
    if (current.followers === null && followers !== null) writeFollow(targetId, { ...current, followers });
    return;
  }
  if (current && current.following === following && current.followers === (followers ?? current.followers)) return;
  writeFollow(targetId, { following, followers: followers ?? current?.followers ?? null, pending: false, dirty: false });
}

/**
 * Takip et (next = true) ya da bırak. Hata olursa durum geri alınır ve
 * kullanıcıya gösterilecek mesaj döner; başarılıysa null.
 */
export async function setFollowing(viewerId: string, targetId: string, next: boolean): Promise<string | null> {
  forViewer(viewerId);
  if (viewerId === targetId) return null;
  const previous = store.follows.get(targetId);
  if (previous?.pending) return null;
  if ((previous?.following ?? false) === next) return null;

  const optimistic: FollowEntry = {
    following: next,
    followers: previous?.followers == null ? null : Math.max(0, previous.followers + (next ? 1 : -1)),
    pending: true,
    dirty: true,
  };
  writeFollow(targetId, optimistic);
  adjustMyFollowingCount(next ? 1 : -1);

  try {
    if (next) await followUser(viewerId, targetId);
    else await unfollowUser(viewerId, targetId);
    if (store.viewerId !== viewerId) return null;
    commit({ follows: new Map(store.follows).set(targetId, { ...optimistic, pending: false }), version: store.version + 1 });
    return null;
  } catch (error) {
    if (store.viewerId !== viewerId) return null;
    writeFollow(targetId, previous ?? { following: !next, followers: null, pending: false, dirty: false });
    adjustMyFollowingCount(next ? -1 : 1);
    return followErrorMessage(error);
  }
}

// ---------------------------------------------------------------
// Satıcı kısa profilleri (akış kartları, ilan sayfası)
// ---------------------------------------------------------------

const inFlight = new Set<string>();

/**
 * Akışa gelen ilanların satıcılarını toplu ister (tek RPC). Bilinen ya da
 * yolda olan satıcılar tekrar istenmez. Takip durumu da buradan tohumlanır.
 */
export async function primeSellerProfiles(ids: readonly (string | null | undefined)[]): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const viewerId = data.session?.user.id ?? null;
  forViewer(viewerId);

  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))].filter(
    (id) => !store.sellers.has(id) && !inFlight.has(id),
  );
  if (wanted.length === 0) return;
  wanted.forEach((id) => inFlight.add(id));

  try {
    const profiles = await fetchSellerProfiles(wanted);
    if (store.viewerId !== viewerId) return;
    const sellers = new Map(store.sellers);
    // Dönmeyen kimlik: herkese açık yüzü yok (null olarak hatırlanır, tekrar sorulmaz)
    for (const id of wanted) sellers.set(id, null);
    for (const profile of profiles) sellers.set(profile.id, profile);
    commit({ sellers });
    if (viewerId) for (const profile of profiles) seedFollowState(viewerId, profile.id, profile.isFollowing);
  } catch (error) {
    console.error("Satıcı profilleri yüklenemedi:", error);
  } finally {
    wanted.forEach((id) => inFlight.delete(id));
  }
}

/** Sunucuda okunmuş satıcı profilini depoya koyar (ilan sayfası) */
export function seedSellerProfile(profile: SellerProfile) {
  if (!store.sellers.get(profile.id)) commit({ sellers: new Map(store.sellers).set(profile.id, profile) });
}

// ---------------------------------------------------------------
// Kancalar
// ---------------------------------------------------------------

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY_STORE: Store = { viewerId: null, follows: new Map(), sellers: new Map(), version: 0 };

function useStore(): Store {
  return useSyncExternalStore(subscribe, () => store, () => EMPTY_STORE);
}

export function useSellerProfile(sellerId: string | null | undefined): SellerProfile | null {
  const snapshot = useStore();
  return sellerId ? (snapshot.sellers.get(sellerId) ?? null) : null;
}

/** "Takip Edilenler" akışının yenilenmesi için: takip listesi her değiştiğinde artar */
export function useFollowVersion(): number {
  return useStore().version;
}

export type FollowControl = {
  viewerId: string | null;
  sessionLoading: boolean;
  following: boolean;
  /** Profil sayfasındaki sayı: iyimser güncel değer (bilinmiyorsa fallback) */
  followers: number | null;
  pending: boolean;
  error: string | null;
  isSelf: boolean;
  /** Oturum yoksa false döner (çağıran giriş penceresini açar) */
  toggle: (next?: boolean, viewerOverride?: string) => Promise<boolean>;
};

export function useFollow(targetId: string | null, fallbackFollowers: number | null = null): FollowControl {
  const { session, isLoading } = useSupabaseSession();
  const viewerId = session?.user.id ?? null;
  const snapshot = useStore();
  const [error, setError] = useState<string | null>(null);

  const entry = targetId && snapshot.viewerId === viewerId ? snapshot.follows.get(targetId) : undefined;
  const following = entry?.following ?? false;

  const toggle = useCallback(
    async (next?: boolean, viewerOverride?: string) => {
      const viewer = viewerOverride ?? viewerId;
      if (!targetId || !viewer) return false;
      setError(null);
      const current = store.viewerId === viewer ? (store.follows.get(targetId)?.following ?? false) : false;
      const message = await setFollowing(viewer, targetId, next ?? !current);
      setError(message);
      return true;
    },
    [targetId, viewerId],
  );

  return {
    viewerId,
    sessionLoading: isLoading,
    following,
    followers: entry?.followers ?? fallbackFollowers,
    pending: entry?.pending ?? false,
    error,
    isSelf: Boolean(viewerId && targetId && viewerId === targetId),
    toggle,
  };
}
