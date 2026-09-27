// Profil fotoğrafı: sunucu ve istemcinin ortak kuralları (UI'dan bağımsız).
// Tarayıcıda sıkıştırma: lib/avatar-image.ts; yükleme: app/api/profile/avatar.

export const AVATAR_BUCKET = "avatars";
/** Kare avatarın kenarı (piksel) */
export const AVATAR_SIZE = 512;
/** Sıkıştırılmış dosyanın üst sınırı: bucket'taki file_size_limit ile aynı */
export const MAX_AVATAR_BYTES = 1024 * 1024;
/** Seçilen ham fotoğrafın üst sınırı (sıkıştırmadan önce) */
export const MAX_AVATAR_SOURCE_BYTES = 20 * 1024 * 1024;

/** Kabul edilen gerçek türler (dosyanın ilk baytlarına göre) */
export type AvatarType = "image/webp" | "image/jpeg" | "image/png";

/**
 * Sunucunun kaydettiği türler; avatars bucket'ının allowed_mime_types değeriyle
 * aynı (bkz. supabase/migrations/*_avatars_allow_png.sql; lib/avatar.test.ts
 * ikisini karşılaştırır).
 */
export const AVATAR_TYPES: readonly AvatarType[] = ["image/webp", "image/jpeg", "image/png"];

export const AVATAR_TYPE_ERROR = "Yalnızca JPG, PNG veya WebP yükleyebilirsiniz.";

/**
 * Dosyanın gerçek türü, ilk baytlarından (uzantıya ya da Content-Type'a
 * güvenilmez): WebP "RIFF....WEBP", JPEG "FF D8 FF", PNG "89 50 4E 47 0D 0A 1A 0A".
 * Başka her şey null.
 */
export function detectAvatarType(bytes: Uint8Array): AvatarType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(1, 4) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}

/** İmzayı tanımak için okunması yeten bayt sayısı */
export const AVATAR_SIGNATURE_BYTES = 12;

// ---------------------------------------------------------------
// Seçilen dosyanın beyan edilen türü (tarayıcının file.type'ı ve uzantı)
// ---------------------------------------------------------------

/**
 * Tarayıcıların bu türler için verdiği adlar. Eski Windows/IE "image/x-png" ve
 * "image/pjpeg", bazı Android galerileri "image/jpg" gönderir.
 */
export const AVATAR_SOURCE_MIME_TYPES: readonly string[] = [
  "image/png",
  "image/x-png",
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/webp",
];
export const AVATAR_SOURCE_EXTENSIONS: readonly string[] = ["png", "jpg", "jpeg", "webp"];

/** Tür bildirmeyen tarayıcıların değerleri (mobilde sık): uzantıya bakılır */
const UNKNOWN_MIME_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

/** "IMAGE/PNG; charset=binary" → "image/png" */
export function normalizeMimeType(type: string | null | undefined): string {
  return (type ?? "").split(";")[0].trim().toLowerCase();
}

/** "Foto.JPEG" → "jpeg"; uzantı yoksa "" */
export function fileExtension(name: string | null | undefined): string {
  const match = /\.([a-z0-9]+)$/i.exec((name ?? "").trim());
  return match ? match[1].toLowerCase() : "";
}

/**
 * Seçilen dosyanın beyanı:
 *   allowed:  tür listede (büyük/küçük harf önemsiz) ya da tür bildirilmemiş ve uzantı listede
 *   unknown:  ne tür ne tanınan bir uzantı var; karar ilk baytlara kalır
 *   rejected: başka bir tür bildirilmiş (video, PDF, GIF, HEIC…)
 * Beyan tek başına yetmez: dosya ayrıca ilk baytlarına göre PNG, JPEG ya da WebP olmalı.
 */
export function declaredAvatarSource(file: { name?: string | null; type?: string | null }): "allowed" | "unknown" | "rejected" {
  const type = normalizeMimeType(file.type);
  if (AVATAR_SOURCE_MIME_TYPES.includes(type)) return "allowed";
  if (!UNKNOWN_MIME_TYPES.has(type)) return "rejected";
  const extension = fileExtension(file.name);
  if (AVATAR_SOURCE_EXTENSIONS.includes(extension)) return "allowed";
  return extension ? "rejected" : "unknown";
}

/**
 * Seçilen dosyanın hatası; uygunsa null. head: dosyanın ilk baytları
 * (en az AVATAR_SIGNATURE_BYTES). Gerçek tür yalnızca imzadan okunur.
 */
export function avatarSourceError(
  file: { name?: string | null; type?: string | null; size: number },
  head: Uint8Array,
): string | null {
  if (declaredAvatarSource(file) === "rejected" || !detectAvatarType(head)) return AVATAR_TYPE_ERROR;
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
