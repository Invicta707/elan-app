"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useSupabaseSession } from "./auth";
import { fetchMyProfile, type MyProfile } from "./profile";

// Oturumdaki kullanıcının profili (görünen ad, avatar): üst çubuk ve Vitrinim
// aynı veriyi paylaşır; avatar değişince her yer anında güncellenir.

type State = { userId: string | null; profile: MyProfile | null; loading: boolean };

let state: State = { userId: null, profile: null, loading: false };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

async function load(userId: string) {
  set({ userId, loading: true, profile: state.userId === userId ? state.profile : null });
  try {
    const profile = await fetchMyProfile(userId);
    if (state.userId === userId) set({ profile, loading: false });
  } catch (error) {
    console.error("Profil yüklenemedi:", error);
    if (state.userId === userId) set({ profile: { displayName: null, avatarUrl: null }, loading: false });
  }
}

/** Kaydedilen değişikliği (ad ya da avatar) her yere yayar */
export function updateMyProfile(change: Partial<MyProfile>) {
  set({ profile: { displayName: null, avatarUrl: null, ...state.profile, ...change } });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: State = { userId: null, profile: null, loading: false };

export function useMyProfile(): { profile: MyProfile | null; loading: boolean } {
  const { session } = useSupabaseSession();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (userId && state.userId !== userId) void load(userId);
    if (!userId && state.userId) set({ userId: null, profile: null, loading: false });
  }, [userId]);

  const snapshot = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  return snapshot.userId === userId ? { profile: snapshot.profile, loading: snapshot.loading } : { profile: null, loading: Boolean(userId) };
}
