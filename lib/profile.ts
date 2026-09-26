import { supabase } from "./supabase";

// Profil: görünen ad ve avatar. UI'dan bağımsız.
//
// profiles satırını yalnızca sahibi okur/yazar (RLS). avatar_url'i yalnızca
// sunucu yazar (app/api/profile/avatar). Başkalarının adı ve avatarı mesajlaşma
// RPC'leriyle gelir (bkz. *_profiles_and_messaging.sql).

export type MyProfile = { displayName: string | null; avatarUrl: string | null };

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
    .select("display_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return { displayName: data?.display_name ?? null, avatarUrl: data?.avatar_url ?? null };
}

export async function saveDisplayName(userId: string, name: string): Promise<string> {
  const displayName = cleanDisplayName(name);
  const error = displayNameError(displayName);
  if (error) throw new Error(error);
  const { error: dbError } = await supabase
    .from("profiles")
    .upsert({ id: userId, display_name: displayName, updated_at: new Date().toISOString() });
  if (dbError) throw new Error("Ad kaydedilemedi. Biraz sonra tekrar dene.");
  return displayName;
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
