// Kullanıcının seçtiği görsel dosyalar (profil fotoğrafı, ilan fotoğrafları):
// tür kuralları. UI'dan ve tarayıcıdan bağımsız; sunucu da kullanır.
// Tarayıcıda açma (decode): lib/image-decode.ts.
//
// Kural: tarayıcının bildirdiği tür (file.type) ya da dosya adı yalnızca ön
// süzgeçtir; gerçek tür her zaman dosyanın ilk baytlarından (imza) okunur.

/** Kabul edilen gerçek türler */
export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export const IMAGE_TYPE_ERROR = "Yalnızca JPG, PNG veya WebP yükleyebilirsiniz.";

/** İmzayı tanımak için okunması yeten bayt sayısı */
export const IMAGE_SIGNATURE_BYTES = 12;

/**
 * Dosyanın gerçek türü, ilk baytlarından (uzantıya ya da Content-Type'a
 * güvenilmez): WebP "RIFF....WEBP", JPEG "FF D8 FF", PNG "89 50 4E 47 0D 0A 1A 0A".
 * Başka her şey (GIF, HEIC, SVG, PDF…) null.
 */
export function detectImageType(bytes: Uint8Array): ImageType | null {
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

/**
 * Tarayıcıların bu türler için verdiği adlar. Eski Windows/IE "image/x-png" ve
 * "image/pjpeg", bazı Android galerileri "image/jpg" gönderir.
 */
export const SOURCE_IMAGE_MIME_TYPES: readonly string[] = [
  "image/png",
  "image/x-png",
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/webp",
];
export const SOURCE_IMAGE_EXTENSIONS: readonly string[] = ["png", "jpg", "jpeg", "webp"];

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

export type DeclaredFile = { name?: string | null; type?: string | null };

/**
 * Seçilen dosyanın beyanı:
 *   allowed:  tür listede (büyük/küçük harf önemsiz) ya da tür bildirilmemiş ve uzantı listede
 *   unknown:  ne tür ne tanınan bir uzantı var; karar ilk baytlara kalır
 *   rejected: başka bir tür bildirilmiş (video, PDF, GIF, HEIC…)
 * Beyan tek başına yetmez: dosya ayrıca ilk baytlarına göre PNG, JPEG ya da WebP olmalı.
 */
export function declaredImageSource(file: DeclaredFile): "allowed" | "unknown" | "rejected" {
  const type = normalizeMimeType(file.type);
  if (SOURCE_IMAGE_MIME_TYPES.includes(type)) return "allowed";
  if (!UNKNOWN_MIME_TYPES.has(type)) return "rejected";
  const extension = fileExtension(file.name);
  if (SOURCE_IMAGE_EXTENSIONS.includes(extension)) return "allowed";
  return extension ? "rejected" : "unknown";
}

/**
 * Seçilen dosyanın gerçek türü: beyan reddedilmemiş ve imza PNG/JPEG/WebP ise o
 * tür, değilse null. head: dosyanın ilk baytları (en az IMAGE_SIGNATURE_BYTES).
 * Beyan ile imza uyuşmazsa (ör. .png adlı JPEG) imza geçerlidir.
 */
export function acceptedImageType(file: DeclaredFile, head: Uint8Array): ImageType | null {
  return declaredImageSource(file) === "rejected" ? null : detectImageType(head);
}
