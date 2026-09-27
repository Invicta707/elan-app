import { AVATAR_SIZE, MAX_AVATAR_BYTES, avatarSourceError, centerSquare } from "./avatar";
import { ImageFileError, decodeImage, readFileHead } from "./image-decode";

// Tarayıcıda profil fotoğrafı hazırlama: türü ilk baytlardan doğrula, ortadan
// kare kırp, 512 px'e küçült, WebP'ye (desteklenmiyorsa JPEG, o da olmazsa PNG)
// sıkıştır. Sunucuya yalnızca bu küçük dosya gider; sunucu türü yine ilk
// baytlardan denetler (lib/avatar-server.ts). Açma yedekleri: lib/image-decode.ts.

/** AvatarPicker bu hatanın mesajını gösterir */
export { ImageFileError as AvatarImageError };

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Çıktı sırası: WebP'yi desteklemeyen tarayıcı PNG döner; o durumda JPEG, en son PNG */
const OUTPUT_FORMATS: readonly (readonly [string, number | undefined])[] = [
  ["image/webp", 0.85],
  ["image/jpeg", 0.85],
  ["image/jpeg", 0.7],
  ["image/png", undefined],
];

export async function compressAvatar(file: File): Promise<Blob> {
  const sourceError = avatarSourceError(file, await readFileHead(file));
  if (sourceError) throw new ImageFileError(sourceError);

  const image = await decodeImage(file);
  const { sx, sy, size } = centerSquare(image.width, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    image.close();
    throw new ImageFileError("Fotoğraf hazırlanamadı.");
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(image.source, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  image.close();

  for (const [type, quality] of OUTPUT_FORMATS) {
    const blob = await toBlob(canvas, type, quality);
    if (blob && blob.type === type && blob.size <= MAX_AVATAR_BYTES) return blob;
  }
  throw new ImageFileError("Fotoğraf küçültülemedi; başka bir fotoğraf dene.");
}
