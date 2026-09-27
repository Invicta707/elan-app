import { IMAGE_TYPE_ERROR, acceptedImageType, type DeclaredFile, type ImageType } from "./image-file";

// Profil fotoğrafı: sunucu ve istemcinin ortak kuralları (UI'dan bağımsız).
// Tarayıcıda sıkıştırma: lib/avatar-image.ts; yükleme: app/api/profile/avatar.
// Tür kuralları (MIME, uzantı, ilk bayt imzası) ilan fotoğraflarıyla ortak: lib/image-file.ts.

export const AVATAR_BUCKET = "avatars";
/** Kare avatarın kenarı (piksel) */
export const AVATAR_SIZE = 512;
/** Sıkıştırılmış dosyanın üst sınırı: bucket'taki file_size_limit ile aynı */
export const MAX_AVATAR_BYTES = 1024 * 1024;
/** Seçilen ham fotoğrafın üst sınırı (sıkıştırmadan önce) */
export const MAX_AVATAR_SOURCE_BYTES = 20 * 1024 * 1024;

export type AvatarType = ImageType;

/**
 * Sunucunun kaydettiği türler; avatars bucket'ının allowed_mime_types değeriyle
 * aynı (bkz. supabase/migrations/*_avatars_allow_png.sql; lib/avatar-bucket.test.ts
 * ikisini karşılaştırır).
 */
export const AVATAR_TYPES: readonly AvatarType[] = ["image/webp", "image/jpeg", "image/png"];

/**
 * Seçilen dosyanın hatası; uygunsa null. head: dosyanın ilk baytları. Gerçek
 * tür yalnızca imzadan okunur (lib/image-file.ts acceptedImageType).
 */
export function avatarSourceError(file: DeclaredFile & { size: number }, head: Uint8Array): string | null {
  if (!acceptedImageType(file, head)) return IMAGE_TYPE_ERROR;
  if (file.size > MAX_AVATAR_SOURCE_BYTES) return "Fotoğraf en fazla 20 MB olabilir.";
  return null;
}

/** Depolama yolu: <kullanıcı>/<zaman>.<uzantı>; her yüklemede yeni ad (önbellek tazelenir) */
export function avatarPath(userId: string, type: AvatarType, now: number = Date.now()): string {
  const extension = type === "image/webp" ? "webp" : type === "image/png" ? "png" : "jpg";
  return `${userId}/${now}.${extension}`;
}

/** Kaynak görüntünün ortasından en büyük kare (kırpma alanı) */
export function centerSquare(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size };
}
