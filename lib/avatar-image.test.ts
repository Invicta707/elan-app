import { describe, expect, it, vi } from "vitest";
import { AVATAR_TYPE_ERROR } from "./avatar";
import {
  AVATAR_DECODE_ERROR,
  AvatarImageError,
  compressAvatar,
  decodeImage,
  readFileHead,
  type DecodedImage,
} from "./avatar-image";

// Tarayıcı tarafı: tür doğrulaması ve çözme yedekleri. Tuval (canvas) çizimi
// happy-dom'da yok; o kısım üretim derlemesinde tarayıcıda denenir.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const GIF = new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000");

const bitmap = (width = 800, height = 600) => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap;

describe("readFileHead", () => {
  it("dosyanın yalnızca ilk baytlarını okur", async () => {
    const file = new File([PNG, new Uint8Array(5000)], "a.png", { type: "image/png" });
    expect([...(await readFileHead(file))]).toEqual([...PNG.subarray(0, 12)]);
  });
});

describe("decodeImage", () => {
  it("önce EXIF yönüyle createImageBitmap", async () => {
    const createBitmap = vi.fn(async () => bitmap());
    const decoded = await decodeImage(new Blob([PNG]), { createBitmap });
    expect(createBitmap).toHaveBeenCalledTimes(1);
    expect(createBitmap).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: "from-image" });
    expect(decoded).toMatchObject({ width: 800, height: 600 });
  });

  it("\"from-image\" seçeneğini tanımayan tarayıcı: seçeneksiz yeniden dener (eski hatanın nedeni)", async () => {
    const createBitmap = vi.fn(async (_file: Blob, options?: ImageBitmapOptions) => {
      if (options?.imageOrientation) {
        throw new TypeError("The provided value 'from-image' is not a valid enum value of type ImageOrientation.");
      }
      return bitmap(1080, 1920);
    });
    const decodeElement = vi.fn();
    const decoded = await decodeImage(new Blob([PNG]), { createBitmap, decodeElement });
    expect(decoded).toMatchObject({ width: 1080, height: 1920 });
    expect(createBitmap).toHaveBeenCalledTimes(2);
    expect(decodeElement).not.toHaveBeenCalled();
  });

  it("createImageBitmap açamazsa ya da yoksa <img> ile çözer", async () => {
    const fromElement: DecodedImage = { source: {} as CanvasImageSource, width: 640, height: 640, close: vi.fn() };
    const failing = vi.fn(async () => {
      throw new DOMException("The source image could not be decoded.", "InvalidStateError");
    });
    expect(await decodeImage(new Blob([PNG]), { createBitmap: failing, decodeElement: async () => fromElement })).toBe(fromElement);
    expect(await decodeImage(new Blob([PNG]), { createBitmap: undefined, decodeElement: async () => fromElement })).toBe(fromElement);
  });

  it("boyutu 0 olan sonuç kabul edilmez", async () => {
    const empty = bitmap(0, 0);
    const fromElement: DecodedImage = { source: {} as CanvasImageSource, width: 10, height: 10, close: vi.fn() };
    expect(await decodeImage(new Blob([PNG]), { createBitmap: async () => empty, decodeElement: async () => fromElement })).toBe(fromElement);
    expect(empty.close).toHaveBeenCalled();
  });

  it("hiçbir yöntem açamazsa anlaşılır hata", async () => {
    const fail = async () => {
      throw new Error("decode");
    };
    await expect(decodeImage(new Blob([PNG]), { createBitmap: fail, decodeElement: fail })).rejects.toThrow(AVATAR_DECODE_ERROR);
  });
});

describe("compressAvatar: tür doğrulaması (çizimden önce)", () => {
  it.each([
    ["GIF, tür bildirilmiş", new File([GIF], "a.gif", { type: "image/gif" })],
    ["PNG adlı GIF", new File([GIF], "a.png", { type: "image/png" })],
    ["tür bildirilmemiş, uzantısız GIF", new File([GIF], "IMG_1", { type: "" })],
    ["video", new File([PNG], "a.mp4", { type: "video/mp4" })],
  ])("%s → \"Yalnızca JPG, PNG veya WebP…\"", async (_label, file) => {
    const error = await compressAvatar(file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AvatarImageError);
    expect((error as Error).message).toBe(AVATAR_TYPE_ERROR);
  });

  it.each([
    ["image/x-png", "a.png"],
    ["IMAGE/PNG", "a.png"],
    ["", "a.PNG"],
    ["application/octet-stream", "a.png"],
  ])("geçerli PNG (%j, %s) tür denetiminden geçer, çözmeye ilerler", async (type, name) => {
    // Bu ortamda createImageBitmap/Image yok: tür hatası değil, çözme hatası beklenir
    const error = await compressAvatar(new File([PNG], name, { type })).catch((e: unknown) => e);
    expect((error as Error).message).toBe(AVATAR_DECODE_ERROR);
  });
});
