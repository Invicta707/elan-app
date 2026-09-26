"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useSupabaseSession } from "./auth";
import { fetchUnreadCount } from "./messages";
import { supabase } from "./supabase";

// Okunmamış mesaj sayısı: alt menü ve profil butonu aynı sayıyı paylaşır.
// Tek bir Realtime kanalı açılır (kaç bileşen kullanırsa kullansın); yeni mesaj
// ya da okundu bilgisi gelince sayı yeniden okunur. RLS yalnızca kullanıcının
// kendi konuşmalarındaki değişiklikleri iletir.

let count = 0;
let userId: string | null = null;
let channel: RealtimeChannel | null = null;
let consumers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(next: number) {
  if (next === count) return;
  count = next;
  listeners.forEach((listener) => listener());
}

async function load() {
  const current = userId;
  if (!current) return emit(0);
  try {
    const next = await fetchUnreadCount();
    if (userId === current) emit(next);
  } catch (error) {
    console.error("Okunmamış mesaj sayısı alınamadı:", error);
  }
}

/** Mesaj okundu yapıldıktan sonra rozetin hemen güncellenmesi için */
export function refreshUnreadCount() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(load, 250);
}

function onVisible() {
  if (document.visibilityState === "visible") refreshUnreadCount();
}

function start(nextUserId: string) {
  if (userId === nextUserId && channel) return;
  stop();
  userId = nextUserId;
  channel = supabase
    .channel(`unread:${nextUserId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, refreshUnreadCount)
    .subscribe();
  document.addEventListener("visibilitychange", onVisible);
  void load();
}

function stop() {
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  userId = null;
  document.removeEventListener("visibilitychange", onVisible);
  emit(0);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUnreadCount(): number {
  const { session } = useSupabaseSession();
  const currentUser = session?.user.id ?? null;

  useEffect(() => {
    if (!currentUser) return;
    consumers += 1;
    start(currentUser);
    return () => {
      consumers -= 1;
      if (consumers === 0) stop();
    };
  }, [currentUser]);

  return useSyncExternalStore(subscribe, () => (currentUser ? count : 0), () => 0);
}
