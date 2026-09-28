"use client";

import { useSyncExternalStore } from "react";

// İlanların yorum sayıları için küçük istemci deposu: akış kartındaki yorum
// düğmesi, mobildeki yorum penceresi ve masaüstündeki yan panel aynı sayıyı
// gösterir. Bir yerde yorum yazılır ya da silinirse sayı her yerde değişir.
// Depoda olmayan ilan için akıştan gelen sayı (vehicles.comments_count) geçerli.

const counts = new Map<string, number>();
const listeners = new Set<() => void>();

export function setCommentCount(vehicleId: string, count: number): void {
  const next = Math.max(0, Math.floor(count) || 0);
  if (counts.get(vehicleId) === next) return;
  counts.set(vehicleId, next);
  listeners.forEach((listener) => listener());
}

/** Depodaki sayı (yoksa undefined) */
export function getCommentCount(vehicleId: string): number | undefined {
  return counts.get(vehicleId);
}

/** Önbelleği temizle ve testler için */
export function resetCommentCounts(): void {
  counts.clear();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCommentCount(vehicleId: string, fallback: number): number {
  return useSyncExternalStore(
    subscribe,
    () => counts.get(vehicleId) ?? fallback,
    () => fallback,
  );
}
