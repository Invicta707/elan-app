"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useSupabaseSession } from "../../lib/auth";
import { suggestedDisplayName } from "../../lib/profile";
import { useMyProfile } from "../../lib/use-my-profile";
import { suggestUsername } from "../../lib/username";
import UsernameSheet from "./UsernameSheet";

// Giriş yapmış ama kullanıcı adı olmayan kullanıcıya (mevcut hesaplar, Google
// ile yeni gelenler) bir kez "Kullanıcı adını belirle" penceresi açılır.
// Zorunlu değildir: "Daha sonra" 3 gün boyunca tekrar sormaz; Vitrinim'den
// her zaman belirlenebilir. Yarım kalmaması gereken ekranlarda (ilan verme,
// sohbet, giriş dönüşü) açılmaz.

const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const OPEN_DELAY_MS = 900;

const snoozeKey = (userId: string) => `gozuyle:username-prompt:${userId}`;

function isSnoozed(userId: string): boolean {
  try {
    const until = Number(window.localStorage.getItem(snoozeKey(userId)));
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function snooze(userId: string) {
  try {
    window.localStorage.setItem(snoozeKey(userId), String(Date.now() + SNOOZE_MS));
  } catch {
    // Depolama kapalı: bu oturumda yine sorulmaz (bileşen durumu)
  }
}

/** Pencerenin açılabileceği sayfalar */
export function canPromptOn(pathname: string | null): boolean {
  if (!pathname) return false;
  return !/^\/(auth|sell|admin|privacy|terms|cansu-kamil)(\/|$)/.test(pathname) && !/^\/messages\/./.test(pathname);
}

export default function UsernameOnboarding() {
  const pathname = usePathname();
  const { session } = useSupabaseSession();
  const { profile, loading, failed } = useMyProfile();
  const [open, setOpen] = useState<{ userId: string; suggestion: string } | null>(null);
  const [handled, setHandled] = useState<string | null>(null);

  const userId = session?.user.id ?? null;
  const needsUsername = Boolean(userId && profile && !loading && !failed && !profile.username);
  const eligible = needsUsername && canPromptOn(pathname) && handled !== userId;

  useEffect(() => {
    if (open || !eligible || !userId || !session || isSnoozed(userId)) return;
    const timer = window.setTimeout(() => {
      const name = profile?.displayName ?? suggestedDisplayName(session.user.user_metadata);
      setOpen({ userId, suggestion: suggestUsername(name, session.user.email) });
    }, OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open, eligible, userId, session, profile?.displayName]);

  // Oturum kapandı ya da hesap değişti
  if (!open || open.userId !== userId) return null;

  return (
    <UsernameSheet
      mode="onboarding"
      initialValue={open.suggestion}
      onClose={() => {
        // Kullanıcı adı kaydedildiyse zaten bir daha sorulmaz; kaydetmeden kapattıysa 3 gün ertelenir
        if (userId) {
          snooze(userId);
          setHandled(userId);
        }
        setOpen(null);
      }}
    />
  );
}
