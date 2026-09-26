import type { SupabaseClient } from "@supabase/supabase-js";
import { AVATAR_BUCKET } from "./avatar";
import { PHOTO_BUCKET } from "./listing";

// Hesap silme (Google Play: uygulama içinden hesap silme zorunluluğu).
//
// Veritabanında her şey auth kaydına bağlı ve CASCADE ile silinir:
//   auth.users → public.users → vehicles → videos, vehicle_images, interactions, reports
//   auth.users → profiles → follows (iki yönde; sayaçlar tetikleyiciyle düşer);  public.users → interactions (favoriler dahil)
//   auth.users → conversations → messages; user_blocks; user_reports (bildirilen olarak)
//   Kullanıcının başkalarının ilanları için yaptığı bildirimler kalır, kimliği silinir (SET NULL).
// Veritabanı dışındaki dosyalar (Storage'daki ilan fotoğrafları ve profil
// fotoğrafı, Cloudflare Stream videoları) ayrıca silinir.

type VehicleMediaRow = { id: string; videos: { stream_uid: string | null }[] | null };

export type AccountDeletionDeps = {
  /** Servis anahtarlı (RLS'i atlayan) istemci */
  supabase: SupabaseClient;
  deleteStreamVideo: (streamUid: string) => Promise<void>;
};

export type AccountDeletionResult =
  | { ok: true; vehicles: number; photos: number; videos: number; cleanupFailures: number }
  | { ok: false; error: "lookup_failed" | "delete_failed" };

export async function deleteAccount(userId: string, deps: AccountDeletionDeps): Promise<AccountDeletionResult> {
  const { supabase } = deps;

  // 1) Silinecek dosyaları önceden topla: kayıtlar gidince hangi dosyanın bu
  // kullanıcıya ait olduğu bilinemez. Burada hata olursa hiçbir şey silinmez.
  const { data, error: vehiclesError } = await supabase
    .from("vehicles")
    .select("id, videos(stream_uid)")
    .eq("seller_id", userId);
  if (vehiclesError) {
    console.error("Hesap silme: ilanlar okunamadı:", vehiclesError);
    return { ok: false, error: "lookup_failed" };
  }

  const vehicles = (data ?? []) as unknown as VehicleMediaRow[];
  const streamUids = vehicles.flatMap((v) => (v.videos ?? []).flatMap((video) => video.stream_uid ?? []));
  const photoPaths: string[] = [];
  for (const vehicle of vehicles) {
    const { data: files, error } = await supabase.storage.from(PHOTO_BUCKET).list(vehicle.id, { limit: 1000 });
    if (error) {
      console.error("Hesap silme: fotoğraflar listelenemedi:", vehicle.id, error);
      return { ok: false, error: "lookup_failed" };
    }
    photoPaths.push(...(files ?? []).map((file) => `${vehicle.id}/${file.name}`));
  }
  const { data: avatarFiles, error: avatarError } = await supabase.storage.from(AVATAR_BUCKET).list(userId, { limit: 100 });
  if (avatarError) {
    console.error("Hesap silme: profil fotoğrafı listelenemedi:", avatarError);
    return { ok: false, error: "lookup_failed" };
  }
  const avatarPaths = (avatarFiles ?? []).map((file) => `${userId}/${file.name}`);

  // 2) Hesap: veritabanındaki tüm veriler CASCADE ile gider
  const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error("Hesap silme: kullanıcı silinemedi:", deleteError);
    return { ok: false, error: "delete_failed" };
  }

  // 3) Dosyalar: hesap zaten silindi; buradaki hatalar isteği düşürmez,
  // yetim kalan dosyalar loglanır (sonradan elle temizlenebilir)
  let cleanupFailures = 0;
  if (photoPaths.length > 0) {
    const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(photoPaths);
    if (error) {
      cleanupFailures += photoPaths.length;
      console.error("Hesap silme: fotoğraflar silinemedi:", photoPaths, error);
    }
  }
  if (avatarPaths.length > 0) {
    const { error } = await supabase.storage.from(AVATAR_BUCKET).remove(avatarPaths);
    if (error) {
      cleanupFailures += avatarPaths.length;
      console.error("Hesap silme: profil fotoğrafı silinemedi:", avatarPaths, error);
    }
  }
  const results = await Promise.allSettled(streamUids.map((uid) => deps.deleteStreamVideo(uid)));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      cleanupFailures += 1;
      console.error("Hesap silme: video silinemedi:", streamUids[index], result.reason);
    }
  });

  return {
    ok: true,
    vehicles: vehicles.length,
    photos: photoPaths.length,
    videos: streamUids.length,
    cleanupFailures,
  };
}

// ---------------------------------------------------------------
// İstemci: /api/user/delete çağrısı
// ---------------------------------------------------------------

export type RequestDeletionResult = { ok: true } | { ok: false; message: string };

export async function requestAccountDeletion(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RequestDeletionResult> {
  try {
    const response = await fetchImpl("/api/user/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ confirm: true }),
    });
    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; error?: { message?: string } }
      | null;
    if (response.ok && body?.ok) return { ok: true };
    return { ok: false, message: body?.error?.message ?? "Hesabın silinemedi. Biraz sonra tekrar dene." };
  } catch {
    return { ok: false, message: "Hesabın silinemedi. Bağlantını kontrol edip tekrar dene." };
  }
}
