"use client";

import { useSyncExternalStore } from "react";
import { supabase } from "./supabase";

// İlan izlenme sayacı, istemci tarafı. Sayaç veritabanında
// (vehicles.views_count); yalnızca increment_vehicle_view RPC'si artırır
// (supabase/migrations/20260929100000_vehicle_views.sql).
//
// Ne zaman sayılır:
//   * Masaüstü: Shorts oynatıcısında video gerçekten oynamaya başlayınca
//     (components/portal/ShortsPlayer.tsx). Vitrin kartındaki fareyle
//     önizleme hiç saymaz.
//   * Mobil: akıştaki video ekrandayken en az MOBILE_VIEW_THRESHOLD_MS
//     kesintisiz oynayınca (components/VideoCard.tsx).
// Aynı ilan bir tarayıcı oturumunda (sessionStorage) yalnızca bir kez sayılır:
// videonun döngüsü, ilana geri dönmek ya da oynatıcıyı yeniden açmak sayacı
// şişirmez. sessionStorage yoksa (gizli pencere, engellenmiş depolama) sayfa
// ömrü boyunca bellekte tutulur.
//
// Rozetler aynı küçük depodan okur: sayılan ilanın yeni sayısı kartta, akışta
// ve oynatıcıda hemen görünür.

export const VIEWED_STORAGE_KEY = "gozuyle:viewed:v1";
/** Mobil akışta sayılmak için kesintisiz oynama süresi */
export const MOBILE_VIEW_THRESHOLD_MS = 2000;
/** Oturumda tutulan en fazla ilan (depolama şişmesin; en eskiler düşer) */
const MAX_REMEMBERED = 500;

const memoryViewed = new Set<string>();

function readViewed(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(VIEWED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const ids = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    return new Set([...ids, ...memoryViewed]);
  } catch {
    return new Set(memoryViewed);
  }
}

function writeViewed(ids: Set<string>): void {
  const list = [...ids].slice(-MAX_REMEMBERED);
  memoryViewed.clear();
  list.forEach((id) => memoryViewed.add(id));
  try {
    window.sessionStorage.setItem(VIEWED_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Depolama yok ya da dolu: bellekteki liste yeter
  }
}

/** Bu oturumda sayıldı mı */
export function hasViewed(vehicleId: string): boolean {
  return readViewed().has(vehicleId);
}

/**
 * İzlenmeyi sayar (oturumda ilk kez ise): yeni sayıyı döner. Zaten sayılmışsa,
 * ilan yayında değilse ya da istek başarısızsa null. Ağ hatasında işaret
 * kaldırılır; ilan bir sonraki izlemede yeniden denenir.
 */
export async function recordVehicleView(vehicleId: string): Promise<number | null> {
  if (!vehicleId || hasViewed(vehicleId)) return null;
  // İstek sürerken ikinci bir çağrı (ör. oynat/duraklat) yeniden saymasın
  const viewed = readViewed();
  viewed.add(vehicleId);
  writeViewed(viewed);

  try {
    const { data, error } = await supabase.rpc("increment_vehicle_view", { target_vehicle_id: vehicleId });
    if (error) throw error;
    const count = typeof data === "number" ? data : null;
    if (count !== null) setViewCount(vehicleId, count);
    return count;
  } catch (error) {
    console.error("İzlenme kaydedilemedi:", error);
    const current = readViewed();
    current.delete(vehicleId);
    writeViewed(current);
    return null;
  }
}

/** Testler için: oturum listesini ve sayıları sıfırlar */
export function resetVehicleViews(): void {
  memoryViewed.clear();
  try {
    window.sessionStorage.removeItem(VIEWED_STORAGE_KEY);
  } catch {
    // yok say
  }
  counts.clear();
  listeners.forEach((listener) => listener());
}

// ---------------------------------------------------------------
// Rozetlerin ortak deposu
// ---------------------------------------------------------------

const counts = new Map<string, number>();
const listeners = new Set<() => void>();

export function setViewCount(vehicleId: string, count: number): void {
  const next = Math.max(0, Math.floor(count) || 0);
  if (counts.get(vehicleId) === next) return;
  counts.set(vehicleId, next);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** İlanın gösterilecek izlenme sayısı: depodaki (bu oturumda sayılan) ile listeden gelen sayının büyüğü */
export function useViewCount(vehicleId: string, fallback: number): number {
  const stored = useSyncExternalStore(
    subscribe,
    () => counts.get(vehicleId),
    () => undefined,
  );
  return Math.max(stored ?? 0, Math.max(0, Math.floor(fallback) || 0));
}

// ---------------------------------------------------------------
// Biçim
// ---------------------------------------------------------------

const decimal = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

/**
 * Rozetteki kısa sayı: 0–999 olduğu gibi ("450"), binler "1,2B", milyonlar
 * "1,1M". Ondalık virgül (Türkçe); aşağı yuvarlanır (999.999 → "999,9B",
 * hiçbir zaman "1000B").
 */
export function formatViewCount(value: number): string {
  const count = Math.max(0, Math.floor(value) || 0);
  if (count < 1000) return String(count);
  const [unit, suffix] = count < 1_000_000 ? [1000, "B"] : [1_000_000, "M"];
  return `${decimal.format(Math.floor((count / unit) * 10) / 10)}${suffix}`;
}

/** Ekran okuyucu için tam sayı: "1.234 izlenme" */
export function viewCountLabel(value: number): string {
  return `${whole.format(Math.max(0, Math.floor(value) || 0))} izlenme`;
}
