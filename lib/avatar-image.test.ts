import { describe, expect, it } from "vitest";
import { AvatarImageError, compressAvatar } from "./avatar-image";
import { IMAGE_DECODE_ERROR } from "./image-decode";
import { IMAGE_TYPE_ERROR } from "./image-file";

// Profil fotoğrafı hazırlama: tür doğrulaması çizimden önce yapılır. Açma
// yedekleri lib/image-decode.test.ts'te; tuval (canvas) çizimi tarayıcıda denenir.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const GIF = new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000");

describe("compressAvatar: tür doğrulaması (çizimden önce)", () => {
  it.each([
    ["GIF, tür bildirilmiş", new File([GIF], "a.gif", { type: "image/gif" })],
    ["PNG adlı GIF", new File([GIF], "a.png", { type: "image/png" })],
    ["tür bildirilmemiş, uzantısız GIF", new File([GIF], "IMG_1", { type: "" })],
    ["video", new File([PNG], "a.mp4", { type: "video/mp4" })],
  ])("%s → \"Yalnızca JPG, PNG veya WebP…\"", async (_label, file) => {
    const error = await compressAvatar(file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AvatarImageError);
    expect((error as Error).message).toBe(IMAGE_TYPE_ERROR);
  });

  it.each([
    ["image/x-png", "a.png"],
    ["IMAGE/PNG", "a.png"],
    ["", "a.PNG"],
    ["application/octet-stream", "a.png"],
  ])("geçerli PNG (%j, %s) tür denetiminden geçer, çözmeye ilerler", async (type, name) => {
    // Bu ortamda createImageBitmap/Image yok: tür hatası değil, çözme hatası beklenir
    const error = await compressAvatar(new File([PNG], name, { type })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AvatarImageError);
    expect((error as Error).message).toBe(IMAGE_DECODE_ERROR);
  });
});
