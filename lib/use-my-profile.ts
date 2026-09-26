"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useSupabaseSession } from "./auth";
import { EMPTY_PROFILE, fetchMyProfile, type MyProfile } from "./profile";

// Oturumdaki kullanıcının profili (görünen ad, avatar, kullanıcı adı, takip
// sayıları): üst çubuk, Vitrinim ve kullanıcı adı penceresi aynı veriyi
// paylaşır; bir değişiklik her yerde anında görünür.

type State = { userId: string | null; profile: MyProfile | null; loading: boolean; failed: boolean };

let state: State = { userId: null, profile: null, loading: false, failed: false };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

async function load(userId: string) {
  set({ userId, loading: true, failed: false, profile: state.userId === userId ? state.profile : null });
  try {
    const profile = await fetchMyProfile(userId);
    if (state.userId === userId) set({ profile, loading: false });
  } catch (error) {
    console.error("Profil yüklenemedi:", error);
    // Profil okunamadıysa boş profil gösterilir ama "kullanıcı adı yok" sayılmaz (failed)
    if (state.userId === userId) set({ profile: { ...EMPTY_PROFILE }, loading: false, failed: true });
  }
}

/** Kaydedilen değişikliği (ad, avatar, kullanıcı adı) her yere yayar */
export function updateMyProfile(change: Partial<MyProfile>) {
  set({ profile: { ...EMPTY_PROFILE, ...state.profile, ...change } });
}

/** Takip et / bırak sonrası "Takip" sayısı (iyimser) */
export function adjustMyFollowingCount(delta: number) {
  if (!state.profile) return;
  updateMyProfile({ followingCount: Math.max(0, state.profile.followingCount + delta) });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: State = { userId: null, profile: null, loading: false, failed: false };

export function useMyProfile(): { profile: MyProfile | null; loading: boolean; failed: boolean } {
  const { session } = useSupabaseSession();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (userId && state.userId !== userId) void load(userId);
    if (!userId && state.userId) set({ userId: null, profile: null, loading: false, failed: false });
  }, [userId]);

  const snapshot = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  return snapshot.userId === userId
    ? { profile: snapshot.profile, loading: snapshot.loading, failed: snapshot.failed }
    : { profile: null, loading: Boolean(userId), failed: false };
}
