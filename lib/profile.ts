import { supabase } from "./supabase";
import { localUsernameStatus, normalizeUsername, type UsernameStatus } from "./username";

// Profil: görünen ad, avatar, kullanıcı adı ve takip sayıları. UI'dan bağımsız.
//
// profiles satırını yalnızca sahibi okur/yazar (RLS). avatar_url'i yalnızca
// sunucu yazar (app/api/profile/avatar); kullanıcı adını yalnızca set_username,
// sayaçları yalnızca follows tetikleyicisi yazar. Başkalarının profili
// get_public_profile / get_public_profiles ve mesajlaşma RPC'leriyle gelir.

export type MyProfile = {
  displayName: string | null;
  avatarUrl: string | null;
  username: string | null;
  followersCount: number;
  followingCount: number;
};

export const EMPTY_PROFILE: MyProfile = {
  displayName: null,
  avatarUrl: null,
  username: null,
  followersCount: 0,
  followingCount: 0,
};

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 30;

export function cleanDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Veritabanındaki kuralla aynı (profiles.display_name check) */
export function displayNameError(name: string): string | null {
  const clean = cleanDisplayName(name);
  if (clean.length < DISPLAY_NAME_MIN) return `En az ${DISPLAY_NAME_MIN} karakter yaz.`;
  if (clean.length > DISPLAY_NAME_MAX) return `En fazla ${DISPLAY_NAME_MAX} karakter olabilir.`;
  if (/[\u0000-\u001f\u007f<>]/.test(clean)) return "Adda < ve > kullanılamaz.";
  return null;
}

/** Ad yoksa kullanılacak: giriş sağlayıcısının verdiği ad (Google), e-posta değil */
export function suggestedDisplayName(metadata: Record<string, unknown> | undefined): string {
  const raw = [metadata?.full_name, metadata?.name].find((v): v is string => typeof v === "string" && v.trim() !== "");
  const clean = cleanDisplayName(raw ?? "").slice(0, DISPLAY_NAME_MAX);
  return displayNameError(clean) ? "" : clean;
}

/** Avatarsız gösterimde baş harf */
export function initialOf(name: string | null | undefined, fallback = "?"): string {
  const first = (name ?? "").trim()[0];
  return (first ?? fallback).toLocaleUpperCase("tr");
}

export async function fetchMyProfile(userId: string): Promise<MyProfile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, avatar_url, username, followers_count, following_count")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return {
    displayName: data?.display_name ?? null,
    avatarUrl: data?.avatar_url ?? null,
    username: data?.username ?? null,
    followersCount: Number(data?.followers_count ?? 0),
    followingCount: Number(data?.following_count ?? 0),
  };
}

const USERNAME_STATUSES: readonly UsernameStatus[] = ["invalid", "reserved", "taken", "available", "current"];

/** Kullanıcı adı müsait mi: biçim ve rezerve yerelde, alınmış olup olmadığı sunucuda */
export async function checkUsernameAvailability(name: string): Promise<UsernameStatus> {
  const clean = normalizeUsername(name);
  const local = localUsernameStatus(clean);
  if (local) return local;
  const { data, error } = await supabase.rpc("check_username", { p_username: clean });
  if (error) throw error;
  return USERNAME_STATUSES.includes(data as UsernameStatus) ? (data as UsernameStatus) : "invalid";
}

/** Kullanıcı adını kaydeder; kural ihlalinde veritabanının Türkçe mesajıyla hata fırlatır */
export async function saveUsername(name: string): Promise<string> {
  const { data, error } = await supabase.rpc("set_username", { p_username: normalizeUsername(name) });
  if (error) {
    // 23514 (biçim, rezerve, 7 gün) ve 23505 (alınmış): mesaj veritabanından
    if (error.code === "23514" || error.code === "23505") throw new Error(error.message);
    throw new Error("Kullanıcı adı kaydedilemedi. Biraz sonra tekrar dene.");
  }
  return String(data);
}

export async function saveDisplayName(name: string): Promise<string> {
  const displayName = cleanDisplayName(name);
  const error = displayNameError(displayName);
  if (error) throw new Error(error);
  // Tabloya doğrudan upsert değil: updated_at'e INSERT yetkisi olmadığı için
  // 42501 alıyordu (bkz. *_profile_name_and_blocked_list.sql). Kural ve zaman sunucuda.
  const { data, error: dbError } = await supabase.rpc("update_profile_display_name", { p_name: displayName });
  if (dbError) {
    if (dbError.code === "23514") throw new Error(dbError.message);
    throw new Error("Ad kaydedilemedi. Biraz sonra tekrar dene.");
  }
  return typeof data === "string" ? data : displayName;
}

type AvatarResponse = { avatarUrl?: string | null; error?: { message?: string } };

async function avatarRequest(
  method: "POST" | "DELETE",
  accessToken: string,
  body: Blob | undefined,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; avatarUrl: string | null } | { ok: false; message: string }> {
  let response: Response;
  try {
    response = await fetchImpl("/api/profile/avatar", {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { "Content-Type": body.type } : {}),
      },
      body,
    });
  } catch {
    return { ok: false, message: "Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene." };
  }
  const json = (await response.json().catch(() => null)) as AvatarResponse | null;
  if (response.ok && json) return { ok: true, avatarUrl: json.avatarUrl ?? null };
  return { ok: false, message: json?.error?.message ?? "Profil fotoğrafı kaydedilemedi." };
}

export function uploadAvatar(image: Blob, accessToken: string, fetchImpl: typeof fetch = fetch) {
  return avatarRequest("POST", accessToken, image, fetchImpl);
}

export function removeAvatar(accessToken: string, fetchImpl: typeof fetch = fetch) {
  return avatarRequest("DELETE", accessToken, undefined, fetchImpl);
}
