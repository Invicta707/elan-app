"use client";

import { useCallback, useSyncExternalStore } from "react";

// CSS medya sorgusu, React'e bağlı. Sunucuda ve ilk çizimde false: masaüstüne
// özgü içerik (veri isteyen yan panel) hidrasyondan sonra kurulur; yerleşim
// (sütunlar) CSS'le baştan doğru çizilir.

const serverSnapshot = () => false;

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const snapshot = useCallback(
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    [query],
  );
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

const unresolvedSnapshot = () => null;

/**
 * Aynı sorgu, ama sunucuda ve hidrasyonda null: "henüz bilinmiyor". Ekran
 * genişliğine göre bambaşka veri isteyen iki görünümden (ana sayfa: mobil
 * akış / masaüstü vitrin) hiçbiri, doğru olan belli olmadan kurulmaz.
 */
export function useResolvedMediaQuery(query: string): boolean | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const snapshot = useCallback(
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    [query],
  );
  return useSyncExternalStore<boolean | null>(subscribe, snapshot, unresolvedSnapshot);
}
