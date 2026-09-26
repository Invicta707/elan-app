import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AVATAR_BUCKET, MAX_AVATAR_BYTES, avatarPath, detectAvatarType } from "./avatar";

// Profil fotoğrafını kaydeder/siler (servis anahtarıyla). avatars bucket'ına
// kullanıcı doğrudan yazamaz; profiles.avatar_url'i de yalnızca burası yazar.

export type AvatarResult =
  | { ok: true; avatarUrl: string | null }
  | { ok: false; status: 400 | 413 | 500; message: string };

/** Klasördeki eski avatarları siler (yeni dosya hariç). Hata isteği düşürmez. */
async function removeOthers(supabase: SupabaseClient, userId: string, keep: string | null) {
  const { data, error } = await supabase.storage.from(AVATAR_BUCKET).list(userId, { limit: 100 });
  if (error) {
    console.error("Avatar: eski dosyalar listelenemedi:", error);
    return;
  }
  const stale = (data ?? []).map((file) => `${userId}/${file.name}`).filter((path) => path !== keep);
  if (stale.length === 0) return;
  const { error: removeError } = await supabase.storage.from(AVATAR_BUCKET).remove(stale);
  if (removeError) console.error("Avatar: eski dosyalar silinemedi:", removeError);
}

async function setAvatarUrl(supabase: SupabaseClient, userId: string, avatarUrl: string | null) {
  return supabase
    .from("profiles")
    .upsert({ id: userId, avatar_url: avatarUrl, updated_at: new Date().toISOString() });
}

export async function saveAvatar(
  supabase: SupabaseClient,
  userId: string,
  bytes: Uint8Array,
  now: number = Date.now(),
): Promise<AvatarResult> {
  if (bytes.length === 0) return { ok: false, status: 400, message: "Fotoğraf boş." };
  if (bytes.length > MAX_AVATAR_BYTES) {
    return { ok: false, status: 413, message: "Fotoğraf en fazla 1 MB olabilir." };
  }
  const type = detectAvatarType(bytes);
  if (!type) return { ok: false, status: 400, message: "Profil fotoğrafı WebP ya da JPEG olmalı." };

  const path = avatarPath(userId, type, now);
  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, bytes, { contentType: type, cacheControl: "31536000", upsert: false });
  if (uploadError) {
    console.error("Avatar yüklenemedi:", uploadError);
    return { ok: false, status: 500, message: "Profil fotoğrafı kaydedilemedi. Biraz sonra tekrar dene." };
  }

  const avatarUrl = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
  const { error: profileError } = await setAvatarUrl(supabase, userId, avatarUrl);
  if (profileError) {
    console.error("Avatar: profil güncellenemedi:", profileError);
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    return { ok: false, status: 500, message: "Profil fotoğrafı kaydedilemedi. Biraz sonra tekrar dene." };
  }

  await removeOthers(supabase, userId, path);
  return { ok: true, avatarUrl };
}

export async function deleteAvatar(supabase: SupabaseClient, userId: string): Promise<AvatarResult> {
  const { error } = await setAvatarUrl(supabase, userId, null);
  if (error) {
    console.error("Avatar: profil güncellenemedi:", error);
    return { ok: false, status: 500, message: "Profil fotoğrafı kaldırılamadı. Biraz sonra tekrar dene." };
  }
  await removeOthers(supabase, userId, null);
  return { ok: true, avatarUrl: null };
}
