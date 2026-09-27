"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useSupabaseSession } from "./auth";
import { fetchAdminStatus, type AdminStatus } from "./moderation";

// Oturumdaki kullanıcı yönetici mi, kaç ilan onay bekliyor? Vitrinim ve Ayarlar
// aynı sonucu paylaşır. Yönetici olmayan için oturum boyunca bir kez sorulur;
// yöneticide sayılar ADMIN_STATUS_MAX_AGE_MS'ten eskiyse ya da panelde karar
// verildiyse bir sonraki görünümde yeniden sorulur.

export type AdminStatusState = {
  userId: string | null;
  status: AdminStatus | null;
  fetchedAt: number;
  loading: boolean;
  /** Panelde karar verildi: sayılar bir sonraki görünümde yeniden sorulur */
  stale: boolean;
};

const EMPTY: AdminStatusState = { userId: null, status: null, fetchedAt: 0, loading: false, stale: false };
let state: AdminStatusState = EMPTY;
const listeners = new Set<() => void>();

export const ADMIN_STATUS_MAX_AGE_MS = 30_000;

function set(next: Partial<AdminStatusState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function load(userId: string, accessToken: string, fetchImpl?: typeof fetch) {
  set({ userId, loading: true, stale: false, status: state.userId === userId ? state.status : null });
  const status = await fetchAdminStatus(accessToken, fetchImpl);
  if (state.userId !== userId) return;
  // Sorulamadıysa (ağ hatası) eldeki sonuç kalır; bir sonraki görünümde yeniden sorulur
  set({ loading: false, status: status ?? state.status, fetchedAt: status ? Date.now() : 0 });
}

/** Sorulmalı mı: kullanıcı değişti, hiç sorulmadı, karar verildi ya da yöneticinin sayıları eskidi */
export function adminStatusNeedsLoad(current: AdminStatusState, userId: string, now: number): boolean {
  if (current.userId !== userId) return true;
  if (current.loading) return false;
  if (!current.fetchedAt || current.stale) return true;
  return current.status?.admin === true && now - current.fetchedAt > ADMIN_STATUS_MAX_AGE_MS;
}

/**
 * Panelde bir ilan onaylandı ya da reddedildi: rozet hemen düşer, sayılar bir
 * sonraki görünümde sunucudan yeniden sorulur.
 */
export function adminListingDecided() {
  if (state.status?.admin !== true) return;
  const pending = state.status.pendingListings;
  set({ stale: true, status: { ...state.status, pendingListings: pending === null ? null : Math.max(0, pending - 1) } });
}

/** Testler için: depoyu sıfırlar */
export function resetAdminStatusStore() {
  state = EMPTY;
}

export function useAdminStatus(fetchImpl?: typeof fetch): AdminStatus | null {
  const { session, isLoading } = useSupabaseSession();
  const userId = session?.user.id ?? null;
  const token = session?.access_token ?? null;

  useEffect(() => {
    if (isLoading) return;
    if (!userId || !token) {
      if (state.userId) set(EMPTY);
      return;
    }
    if (adminStatusNeedsLoad(state, userId, Date.now())) void load(userId, token, fetchImpl);
  }, [isLoading, userId, token, fetchImpl]);

  const snapshot = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  return userId && snapshot.userId === userId ? snapshot.status : null;
}
