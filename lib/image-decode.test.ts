import { describe, expect, it, vi } from "vitest";
import {
  IMAGE_DECODE_ERROR,
  ImageFileError,
  decodeImage,
  inspectImageFile,
  readFileHead,
  type DecodedImage,
} from "./image-decode";
import { IMAGE_TYPE_ERROR } from "./image-file";

// Tarayıcıda görsel açma ve seçilen dosyanın denetimi (profil fotoğrafı ve
// /sell ilan fotoğrafları). Gerçek çözme tarayıcıda denenir; burada yedek sırası
// ve kararlar sahte çözücüyle sınanır.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const WEBP = new Uint8Array([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8 ")]);
const GIF = new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000");

const bitmap = (width = 800, height = 600) => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap;
const decoded = (width = 1200, height = 900): DecodedImage => ({ source: {} as CanvasImageSource, width, height, close: vi.fn() });

describe("readFileHead", () => {
  it("dosyanın yalnızca ilk baytlarını okur", async () => {
    const file = new File([PNG, new Uint8Array(5000)], "a.png", { type: "image/png" });
    expect([...(await readFileHead(file))]).toEqual([...PNG.subarray(0, 12)]);
  });
});

describe("decodeImage", () => {
  it("önce EXIF yönüyle createImageBitmap", async () => {
    const createBitmap = vi.fn(async () => bitmap());
    const result = await decodeImage(new Blob([PNG]), { createBitmap });
    expect(createBitmap).toHaveBeenCalledTimes(1);
    expect(createBitmap).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: "from-image" });
    expect(result).toMatchObject({ width: 800, height: 600 });
  });

  it("\"from-image\" seçeneğini tanımayan tarayıcı: seçeneksiz yeniden dener (eski hatanın nedeni)", async () => {
    const createBitmap = vi.fn(async (_file: Blob, options?: ImageBitmapOptions) => {
      if (options?.imageOrientation) {
        throw new TypeError("The provided value 'from-image' is not a valid enum value of type ImageOrientation.");
      }
      return bitmap(1080, 1920);
    });
    const decodeElement = vi.fn();
    const result = await decodeImage(new Blob([PNG]), { createBitmap, decodeElement });
    expect(result).toMatchObject({ width: 1080, height: 1920 });
    expect(createBitmap).toHaveBeenCalledTimes(2);
    expect(decodeElement).not.toHaveBeenCalled();
  });

  it("createImageBitmap açamazsa ya da yoksa <img> ile çözer", async () => {
    const fromElement = decoded(640, 640);
    const failing = vi.fn(async () => {
      throw new DOMException("The source image could not be decoded.", "InvalidStateError");
    });
    expect(await decodeImage(new Blob([PNG]), { createBitmap: failing, decodeElement: async () => fromElement })).toBe(fromElement);
    expect(await decodeImage(new Blob([PNG]), { createBitmap: undefined, decodeElement: async () => fromElement })).toBe(fromElement);
  });

  it("boyutu 0 olan sonuç kabul edilmez", async () => {
    const empty = bitmap(0, 0);
    const fromElement = decoded(10, 10);
    expect(await decodeImage(new Blob([PNG]), { createBitmap: async () => empty, decodeElement: async () => fromElement })).toBe(fromElement);
    expect(empty.close).toHaveBeenCalled();
  });

  it("hiçbir yöntem açamazsa anlaşılır hata", async () => {
    const fail = async () => {
      throw new Error("decode");
    };
    const error = await decodeImage(new Blob([PNG]), { createBitmap: fail, decodeElement: fail }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageFileError);
    expect((error as Error).message).toBe(IMAGE_DECODE_ERROR);
  });
});

describe("inspectImageFile (/sell ilan fotoğrafları)", () => {
  const limits = { maxBytes: 10 * 1024 * 1024, sizeError: "Fotoğraflar en fazla 10 MB olabilir." };

  it.each([
    ["image/png", "foto.png", PNG, "image/png"],
    ["image/x-png", "foto.png", PNG, "image/png"],
    ["IMAGE/PNG", "FOTO.PNG", PNG, "image/png"],
    ["", "IMG_1.png", PNG, "image/png"],
    ["application/octet-stream", "IMG_2.PNG", PNG, "image/png"],
    ["image/jpg", "foto.jpg", JPEG, "image/jpeg"],
    ["image/pjpeg", "foto.jpeg", JPEG, "image/jpeg"],
    ["image/webp", "foto.webp", WEBP, "image/webp"],
    ["", "IMG_1234", JPEG, "image/jpeg"],
  ] as const)("%j %s → kabul, gerçek tür %s", async (type, name, bytes, expected) => {
    const decode = vi.fn(async () => decoded());
    const result = await inspectImageFile(new File([bytes], name, { type }), { ...limits, decode });
    expect(result).toEqual({ ok: true, type: expected, width: 1200, height: 900 });
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("açılan görüntü hemen serbest bırakılır", async () => {
    const image = decoded();
    await inspectImageFile(new File([PNG], "a.png", { type: "image/png" }), { ...limits, decode: async () => image });
    expect(image.close).toHaveBeenCalled();
  });

  it("tür uygun değilse açmaya çalışılmaz", async () => {
    const decode = vi.fn(async () => decoded());
    for (const file of [
      new File([GIF], "a.gif", { type: "image/gif" }),
      new File([GIF], "sahte.png", { type: "image/png" }),
      new File([PNG], "video.mp4", { type: "video/mp4" }),
    ]) {
      expect(await inspectImageFile(file, { ...limits, decode })).toEqual({ ok: false, message: IMAGE_TYPE_ERROR });
    }
    expect(decode).not.toHaveBeenCalled();
  });

  it("boyut sınırının üstü reddedilir", async () => {
    const big = new File([PNG, new Uint8Array(11 * 1024 * 1024)], "buyuk.png", { type: "image/png" });
    expect(await inspectImageFile(big, { ...limits, decode: async () => decoded() })).toEqual({
      ok: false,
      message: "Fotoğraflar en fazla 10 MB olabilir.",
    });
  });

  it("imzası doğru ama açılamayan (bozuk) dosya reddedilir", async () => {
    const decode = async () => {
      throw new ImageFileError(IMAGE_DECODE_ERROR);
    };
    expect(await inspectImageFile(new File([PNG], "bozuk.png", { type: "image/png" }), { ...limits, decode })).toEqual({
      ok: false,
      message: IMAGE_DECODE_ERROR,
    });
  });
});
