import { AVATAR_SIZE, MAX_AVATAR_BYTES, MAX_AVATAR_SOURCE_BYTES, centerSquare } from "./avatar";

// Tarayıcıda profil fotoğrafı hazırlama: ortadan kare kırp, 512 px'e küçült,
// WebP'ye (desteklenmiyorsa JPEG'e) sıkıştır. Sunucuya yalnızca bu küçük dosya gider.

export class AvatarImageError extends Error {}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function compressAvatar(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new AvatarImageError("Bir fotoğraf seç.");
  if (file.size > MAX_AVATAR_SOURCE_BYTES) throw new AvatarImageError("Fotoğraf en fazla 20 MB olabilir.");

  let bitmap: ImageBitmap;
  try {
    // Telefon fotoğraflarındaki yön bilgisi (EXIF) uygulanır
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new AvatarImageError("Bu fotoğraf okunamadı; JPEG ya da PNG bir fotoğraf seç.");
  }

  const { sx, sy, size } = centerSquare(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new AvatarImageError("Fotoğraf hazırlanamadı.");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();

  // WebP desteklenmiyorsa tarayıcı PNG döner; o durumda JPEG
  for (const [type, quality] of [
    ["image/webp", 0.85],
    ["image/jpeg", 0.85],
    ["image/jpeg", 0.7],
  ] as const) {
    const blob = await toBlob(canvas, type, quality);
    if (blob && blob.type === type && blob.size <= MAX_AVATAR_BYTES) return blob;
  }
  throw new AvatarImageError("Fotoğraf küçültülemedi; başka bir fotoğraf dene.");
}
