import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// Ayarlar sayfası: bildirim tercihleri, engellenen kullanıcılar ve hesap
// bilgisi yardımcıları. UI'dan bağımsız.

export type NotificationPrefs = {
  /** Yeni mesaj geldiğinde */
  messages: boolean;
  /** Biri takip ettiğinde */
  followers: boolean;
  /** Takip edilen satıcı yeni ilan yayınladığında */
  followingListings: boolean;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  messages: true,
  followers: true,
  followingListings: true,
};

/**
 * Tercihler kullanıcının auth kaydında (user_metadata.notification_prefs)
 * durur: şema değişikliği gerekmez, bildirim gönderen sunucu tarafı
 * auth.users'tan okuyabilir. Eksik ya da bozuk alanlar varsayılana (açık) döner.
 */
export function readNotificationPrefs(metadata: Record<string, unknown> | undefined): NotificationPrefs {
  const raw = metadata?.notification_prefs;
  const prefs = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = (key: keyof NotificationPrefs) =>
    typeof prefs[key] === "boolean" ? (prefs[key] as boolean) : DEFAULT_NOTIFICATION_PREFS[key];
  return { messages: pick("messages"), followers: pick("followers"), followingListings: pick("followingListings") };
}

export async function saveNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data: { notification_prefs: prefs } });
  if (error) throw new Error("Tercih kaydedilemedi. Bağlantını kontrol edip tekrar dene.");
}

/** Ayarlar'da gösterilen giriş yöntemi */
export function signInMethodLabel(user: Pick<User, "app_metadata">): string {
  const providers = [
    ...(Array.isArray(user.app_metadata?.providers) ? (user.app_metadata.providers as unknown[]) : []),
    user.app_metadata?.provider,
  ].filter((p): p is string => typeof p === "string");
  if (providers.includes("google")) return "Google";
  if (providers.includes("email")) return "E-posta ve şifre";
  return "E-posta";
}

export type BlockedUser = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  blockedAt: string;
};

export function toBlockedUser(raw: unknown): BlockedUser | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
  const id = text(row.id);
  if (!id) return null;
  return {
    id,
    username: text(row.username),
    displayName: text(row.display_name),
    avatarUrl: text(row.avatar_url),
    blockedAt: text(row.blocked_at) ?? "",
  };
}

/** Kendi engellediğin kullanıcılar, en yeni önce (list_blocked_users RPC'si) */
export async function fetchBlockedUsers(): Promise<BlockedUser[]> {
  const { data, error } = await supabase.rpc("list_blocked_users");
  if (error) throw new Error("Engellenen kullanıcılar yüklenemedi.");
  return (Array.isArray(data) ? data : []).map(toBlockedUser).filter((u): u is BlockedUser => u !== null);
}
