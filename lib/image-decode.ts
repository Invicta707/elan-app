import { IMAGE_SIGNATURE_BYTES, IMAGE_TYPE_ERROR, acceptedImageType, type DeclaredFile, type ImageType } from "./image-file";

// Tarayıcıda seçilen görseli açma (decode) ve doğrulama. Profil fotoğrafı
// (lib/avatar-image.ts) ve ilan fotoğrafları (app/sell) aynı yolu kullanır.

/** Kullanıcıya gösterilebilir mesajlı hata */
export class ImageFileError extends Error {}

export const IMAGE_DECODE_ERROR = "Bu fotoğraf açılamadı; başka bir fotoğraf dene.";

/** Dosyanın ilk baytları (tür imzası için) */
export async function readFileHead(file: Blob, length: number = IMAGE_SIGNATURE_BYTES): Promise<Uint8Array> {
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

export type DecodeDeps = {
  createBitmap?: CreateBitmap;
  decodeElement?: (file: Blob) => Promise<DecodedImage>;
};

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
 * Görseli çizilebilir hâle getirir. Sırayla:
 *   1) createImageBitmap + imageOrientation "from-image" (telefon fotoğrafının
 *      EXIF yönü uygulanır)
 *   2) seçeneksiz createImageBitmap: "from-image" değerini tanımayan tarayıcılar
 *      (eski Safari/Chrome, bazı uygulama içi tarayıcılar) 1. adımda TypeError
 *      verir; geçerli bir PNG bile "okunamadı" sayılıyordu
 *   3) <img> + decode()
 * Hepsi başarısızsa ImageFileError (IMAGE_DECODE_ERROR).
 */
export async function decodeImage(
  file: Blob,
  {
    createBitmap = typeof createImageBitmap === "function" ? createImageBitmap : undefined,
    decodeElement = decodeWithImageElement,
  }: DecodeDeps = {},
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
  throw new ImageFileError(IMAGE_DECODE_ERROR);
}

export type InspectedImage =
  | { ok: true; type: ImageType; width: number; height: number }
  | { ok: false; message: string };

/**
 * Seçilen dosyayı yüklemeden önce doğrular: tür (beyan + ilk baytlar), boyut ve
 * tarayıcının dosyayı gerçekten açabildiği. Açılan görüntü hemen serbest
 * bırakılır; çağıran, yüklemede dönen gerçek türü kullanmalı.
 */
export async function inspectImageFile(
  file: Blob & DeclaredFile,
  { maxBytes, sizeError, decode = decodeImage }: { maxBytes: number; sizeError: string; decode?: (file: Blob) => Promise<DecodedImage> },
): Promise<InspectedImage> {
  const type = acceptedImageType(file, await readFileHead(file));
  if (!type) return { ok: false, message: IMAGE_TYPE_ERROR };
  if (file.size > maxBytes) return { ok: false, message: sizeError };
  try {
    const image = await decode(file);
    const { width, height } = image;
    image.close();
    return { ok: true, type, width, height };
  } catch (error) {
    return { ok: false, message: error instanceof ImageFileError ? error.message : IMAGE_DECODE_ERROR };
  }
}
