"use client";

import { useSyncExternalStore } from "react";

// Videoların ses durumu: mobil akış (iki sekme) ve masaüstü Shorts oynatıcısı
// tek bir tercihi paylaşır (TikTok / Shorts mantığı).
//
//   * preference: kullanıcının seçimi. Varsayılan "on" (ses açık); ses
//     düğmesiyle kapatınca "off". localStorage'da kalır: sonraki videolarda,
//     kaydırmalarda ve sayfaya yeniden gelişte aynı.
//   * blocked: tarayıcı sesli otomatik oynatmayı reddetti (NotAllowedError;
//     ör. bağlantıyla doğrudan gelindi, sayfada henüz kullanıcı jesti yok).
//     Video sessiz oynar, üstünde "Sesi aç" rozeti görünür ve sayfadaki ilk
//     dokunuş (click) ya da tuş sesi açar. Ses bu jestin içinde, eşzamanlı
//     açılır (iOS Safari ancak böyle izin verir): ekrandaki videolar kayıtlı
//     (registerSoundTarget). Tercih değişmez; engel yalnızca bu sayfa ömrü için.
//
// Kartın kendisine yapılan ilk dokunuş sesi açar ama videoyu durdurmaz
// (isUnlockEvent).

export const SOUND_STORAGE_KEY = "gozuyle:sound:v1";

export type SoundPreference = "on" | "off";
type SoundState = { preference: SoundPreference; blocked: boolean };

const SERVER_STATE: SoundState = { preference: "on", blocked: false };

let state: SoundState = SERVER_STATE;
let loaded = false;
const listeners = new Set<() => void>();
const targets = new Set<HTMLVideoElement>();
let unlockEvent: Event | null = null;
let unlockAttached = false;

function load(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    if (window.localStorage.getItem(SOUND_STORAGE_KEY) === "off") state = { ...state, preference: "off" };
  } catch {
    // Depolama yok (gizli pencere): varsayılan "on"
  }
}

function emit(next: SoundState): void {
  if (next.preference === state.preference && next.blocked === state.blocked) return;
  state = next;
  listeners.forEach((listener) => listener());
}

function getSnapshot(): SoundState {
  load();
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Ses düğmesi: tercihi değiştirir (kalıcı) ve engeli kaldırır */
export function setSoundMuted(muted: boolean): void {
  load();
  const preference: SoundPreference = muted ? "off" : "on";
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, preference);
  } catch {
    // Depolama yok: tercih bu sayfa ömrü boyunca geçerli
  }
  detachUnlock();
  emit({ preference, blocked: false });
}

/** Tarayıcı sesli oynatmayı reddetti: video sessiz oynar, ilk jest sesi açar */
export function markSoundBlocked(): void {
  load();
  if (state.preference === "off") return;
  emit({ ...state, blocked: true });
  attachUnlock();
}

/** Ekrandaki video: engel kalkınca sesi jestin içinde açılır. Dönen fonksiyon kaydı siler. */
export function registerSoundTarget(video: HTMLVideoElement): () => void {
  targets.add(video);
  return () => {
    targets.delete(video);
  };
}

/** Bu tıklama/tuş sesi açan ilk jest miydi (kart ayrıca durdur/oynat yapmasın) */
export function isUnlockEvent(event: Event | null | undefined): boolean {
  return Boolean(event) && event === unlockEvent;
}

function unlock(event: Event): void {
  if (!state.blocked) return;
  unlockEvent = event;
  for (const video of targets) {
    video.muted = false;
    if (video.paused) void video.play().catch(() => {});
  }
  detachUnlock();
  emit({ ...state, blocked: false });
}

function attachUnlock(): void {
  if (unlockAttached || typeof document === "undefined") return;
  unlockAttached = true;
  // Yakalama aşamasında: kartın kendi tıklama işleyicisinden önce
  document.addEventListener("click", unlock, true);
  document.addEventListener("keydown", unlock, true);
}

function detachUnlock(): void {
  if (!unlockAttached) return;
  unlockAttached = false;
  document.removeEventListener("click", unlock, true);
  document.removeEventListener("keydown", unlock, true);
}

/** Etkin ses durumu: tercih kapalıysa ya da tarayıcı engellediyse sessiz */
export function useSound(): { muted: boolean; blocked: boolean; setMuted: (muted: boolean) => void } {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_STATE);
  return {
    muted: snapshot.preference === "off" || snapshot.blocked,
    blocked: snapshot.blocked && snapshot.preference === "on",
    setMuted: setSoundMuted,
  };
}

/** Testler için: tercih ve engel sıfırlanır, depolama tekrar okunur */
export function resetSound(): void {
  detachUnlock();
  targets.clear();
  unlockEvent = null;
  loaded = false;
  state = SERVER_STATE;
  listeners.forEach((listener) => listener());
}
