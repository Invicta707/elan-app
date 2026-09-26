// Profil fotoğrafı: sunucu ve istemcinin ortak kuralları (UI'dan bağımsız).
// Tarayıcıda sıkıştırma: lib/avatar-image.ts; yükleme: app/api/profile/avatar.

export const AVATAR_BUCKET = "avatars";
/** Kare avatarın kenarı (piksel) */
export const AVATAR_SIZE = 512;
/** Sıkıştırılmış dosyanın üst sınırı: bucket'taki file_size_limit ile aynı */
export const MAX_AVATAR_BYTES = 1024 * 1024;
/** Seçilen ham fotoğrafın üst sınırı (sıkıştırmadan önce) */
export const MAX_AVATAR_SOURCE_BYTES = 20 * 1024 * 1024;

export type AvatarType = "image/webp" | "image/jpeg";

/**
 * Dosyanın gerçek türü, ilk baytlarından (uzantıya ya da Content-Type'a
 * güvenilmez): WebP "RIFF....WEBP", JPEG "FF D8 FF". Başka her şey null.
 */
export function detectAvatarType(bytes: Uint8Array): AvatarType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** Depolama yolu: <kullanıcı>/<zaman>.<uzantı>; her yüklemede yeni ad (önbellek tazelenir) */
export function avatarPath(userId: string, type: AvatarType, now: number = Date.now()): string {
  return `${userId}/${now}.${type === "image/webp" ? "webp" : "jpg"}`;
}

/** Kaynak görüntünün ortasından en büyük kare (kırpma alanı) */
export function centerSquare(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size };
}
