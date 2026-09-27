import {
  AVATAR_SIGNATURE_BYTES,
  AVATAR_SIZE,
  MAX_AVATAR_BYTES,
  avatarSourceError,
  centerSquare,
} from "./avatar";

// Tarayıcıda profil fotoğrafı hazırlama: türü ilk baytlardan doğrula, ortadan
// kare kırp, 512 px'e küçült, WebP'ye (desteklenmiyorsa JPEG, o da olmazsa PNG)
// sıkıştır. Sunucuya yalnızca bu küçük dosya gider; sunucu türü yine ilk
// baytlardan denetler (lib/avatar-server.ts).

export class AvatarImageError extends Error {}

export const AVATAR_DECODE_ERROR = "Bu fotoğraf açılamadı; başka bir fotoğraf dene.";

/** Dosyanın ilk baytları (tür imzası için) */
export async function readFileHead(file: Blob, length: number = AVATAR_SIGNATURE_BYTES): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, length).arrayBuffer());
}

export type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Bellek/adres serbest bırakılır */
  close: () => void;
};

type CreateBitmap = (image: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>;

/** <img> ile çözme: createImageBitmap'i olmayan ya da dosyayı açamayan tarayıcılar için */
async function decodeWithImageElement(file: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/**
 * Fotoğrafı çizilebilir hâle getirir. Sırayla:
 *   1) createImageBitmap + imageOrientation "from-image" (telefon fotoğrafının
 *      EXIF yönü uygulanır)
 *   2) seçeneksiz createImageBitmap: "from-image" değerini tanımayan tarayıcılar
 *      (eski Safari/Chrome, bazı uygulama içi tarayıcılar) 1. adımda TypeError
 *      verir; geçerli bir PNG bile "okunamadı" sayılıyordu
 *   3) <img> + decode()
 * Hepsi başarısızsa AvatarImageError.
 */
export async function decodeImage(
  file: Blob,
  {
    createBitmap = typeof createImageBitmap === "function" ? createImageBitmap : undefined,
    decodeElement = decodeWithImageElement,
  }: { createBitmap?: CreateBitmap; decodeElement?: (file: Blob) => Promise<DecodedImage> } = {},
): Promise<DecodedImage> {
  const attempts: (() => Promise<DecodedImage>)[] = [];
  if (createBitmap) {
    const fromBitmap = (bitmap: ImageBitmap): DecodedImage => ({
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    });
    attempts.push(async () => fromBitmap(await createBitmap(file, { imageOrientation: "from-image" })));
    attempts.push(async () => fromBitmap(await createBitmap(file)));
  }
  attempts.push(() => decodeElement(file));

  for (const attempt of attempts) {
    try {
      const decoded = await attempt();
      if (decoded.width > 0 && decoded.height > 0) return decoded;
      decoded.close();
    } catch {
      // Sıradaki yöntem denenir
    }
  }
  throw new AvatarImageError(AVATAR_DECODE_ERROR);
}

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
  if (sourceError) throw new AvatarImageError(sourceError);

  const image = await decodeImage(file);
  const { sx, sy, size } = centerSquare(image.width, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    image.close();
    throw new AvatarImageError("Fotoğraf hazırlanamadı.");
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(image.source, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  image.close();

  for (const [type, quality] of OUTPUT_FORMATS) {
    const blob = await toBlob(canvas, type, quality);
    if (blob && blob.type === type && blob.size <= MAX_AVATAR_BYTES) return blob;
  }
  throw new AvatarImageError("Fotoğraf küçültülemedi; başka bir fotoğraf dene.");
}
