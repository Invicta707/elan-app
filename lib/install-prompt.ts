"use client";

import { useSyncExternalStore } from "react";

// "Uygulamayı yükle" (ana ekrana ekle). Chromium tarayıcılar site kurulabilir
// olunca (public/manifest.json + ikonlar) `beforeinstallprompt` olayını bir kez
// gönderir. Olay burada yakalanır ve saklanır: tarayıcının kendi alt çubuğu
// (mini-infobar) çıkmaz, kurulum penceresini mobil akıştaki "Uygulamayı yükle"
// hapı açar (components/pwa/InstallAppButton.tsx).
//
// Kullanıcı hapı kapatır ya da tarayıcının penceresinde "İptal"e basarsa 7 gün
// boyunca yeniden gösterilmez (localStorage). Uygulama olarak açılmışsa
// (display-mode: standalone, Play Store / TWA dahil) ya da kurulduysa hiç
// gösterilmez. iOS Safari bu olayı desteklemez; orada hap çıkmaz.
//
// Olay sayfa açılırken erken gelebilir: dinleyici modül yüklenince bağlanır ve
// kök düzen (app/layout.tsx → InstallPromptCapture) bu modülü her sayfada yükler.

export const INSTALL_DISMISS_KEY = "gozuyle:install-dismissed:v1";
export const INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

/** Chromium'a özgü olay (standart DOM tiplerinde yok) */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

type InstallState = {
  /** Saklanan bir kurulum olayı var: prompt() çağrılabilir */
  available: boolean;
  /** 7 gün içinde reddedildi, kuruldu ya da uygulama olarak açık */
  suppressed: boolean;
};

const SERVER_STATE: InstallState = { available: false, suppressed: true };

let state: InstallState = SERVER_STATE;
let loaded = false;
let deferred: BeforeInstallPromptEvent | null = null;
let captured: Window | null = null;
const listeners = new Set<() => void>();

function readStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Son reddin üzerinden 7 gün geçmediyse true; kayıt yoksa, bozuksa ya da depolama yoksa false */
export function isInstallDismissed(now = Date.now(), storage: Storage | null = readStorage()): boolean {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(INSTALL_DISMISS_KEY) ?? null;
  } catch {
    return false;
  }
  const at = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(at)) return false;
  // Saat geri alınmış olsa da (gelecekte bir zaman) sonsuza dek gizlenmesin
  return at <= now && now - at < INSTALL_DISMISS_MS;
}

function isStandalone(): boolean {
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  } catch {
    // matchMedia yok
  }
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function load(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  state = { available: deferred !== null, suppressed: isStandalone() || isInstallDismissed() };
}

function update(next: Partial<InstallState>): void {
  load();
  const merged = { ...state, ...next };
  if (merged.available === state.available && merged.suppressed === state.suppressed) return;
  state = merged;
  listeners.forEach((listener) => listener());
}

function onBeforeInstallPrompt(event: Event): void {
  // Tarayıcının kendi kurulum çubuğu çıkmasın; pencereyi hap açar
  event.preventDefault();
  deferred = event as BeforeInstallPromptEvent;
  update({ available: true });
}

function onAppInstalled(): void {
  deferred = null;
  try {
    readStorage()?.removeItem(INSTALL_DISMISS_KEY);
  } catch {
    // Depolama yok
  }
  update({ available: false, suppressed: true });
}

/** Olay dinleyicilerini bir kez bağlar (modül yüklenince kendiliğinden çağrılır) */
export function captureInstallPrompt(target: Window | undefined = typeof window === "undefined" ? undefined : window): void {
  if (!target || captured === target) return;
  captured?.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  captured?.removeEventListener("appinstalled", onAppInstalled);
  captured = target;
  target.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  target.addEventListener("appinstalled", onAppInstalled);
}

/** Hapın ✕'i ya da tarayıcı penceresinde "İptal": 7 gün gösterilmez */
export function dismissInstall(now = Date.now()): void {
  try {
    readStorage()?.setItem(INSTALL_DISMISS_KEY, String(now));
  } catch {
    // Depolama yok: bu sayfa ömrü boyunca gizli kalır
  }
  update({ suppressed: true });
}

/**
 * Tarayıcının kurulum penceresini açar. Olay yalnızca bir kez kullanılabilir;
 * sonuç ne olursa olsun hap kaybolur. "dismissed" 7 günlük beklemeyi başlatır.
 */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferred;
  if (!event) return "unavailable";
  deferred = null;
  update({ available: false });
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "dismissed") dismissInstall();
    return outcome;
  } catch (error) {
    console.error("Kurulum penceresi açılamadı:", error);
    return "unavailable";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): InstallState {
  load();
  return state;
}

/** "Uygulamayı yükle" gösterilsin mi: olay yakalandı, reddedilmedi, uygulama içinde değil */
export function useInstallPrompt(): boolean {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_STATE);
  return current.available && !current.suppressed;
}

/** Testler için: saklanan olayı ve durumu sıfırlar (dinleyiciler bağlı kalır) */
export function resetInstallPrompt(): void {
  deferred = null;
  loaded = false;
  state = SERVER_STATE;
  listeners.forEach((listener) => listener());
}

captureInstallPrompt();
