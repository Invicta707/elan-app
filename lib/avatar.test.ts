import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import { avatarPath, avatarSourceError, centerSquare } from "./avatar";
import { IMAGE_TYPE_ERROR as AVATAR_TYPE_ERROR } from "./image-file";
import { displayNameError, initialOf, suggestedDisplayName } from "./profile";

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])));

// Gerçek dosyaların ilk baytları
const PNG = bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, "JFIF");
const WEBP = bytes("RIFF", 0, 0, 0, 0, "WEBP", "VP8 ");
const GIF = bytes("GIF89a", 0, 0, 0, 0, 0, 0);
const HEIC = bytes(0, 0, 0, 0x18, "ftypheic");
const PDF = bytes("%PDF-1.7", 0, 0, 0, 0);

describe("avatarSourceError", () => {
  const file = (type: string, name: string, size = 500_000) => ({ type, name, size });

  it.each([
    ["image/x-png", "foto.png", PNG],
    ["IMAGE/PNG", "foto.png", PNG],
    ["image/png", "foto.png", PNG],
    ["image/jpeg", "foto.jpg", JPEG],
    ["image/pjpeg", "foto.jpg", JPEG],
    ["image/webp", "foto.webp", WEBP],
    ["", "foto.png", PNG],
    ["application/octet-stream", "foto.webp", WEBP],
    ["", "IMG_1234", PNG],
  ])("geçerli: %j %s", (type, name, head) => {
    expect(avatarSourceError(file(type, name), head)).toBeNull();
  });

  it("beyan ile içerik uyuşmasa da içerik geçerliyse kabul (ör. .png adlı JPEG)", () => {
    expect(avatarSourceError(file("image/png", "foto.png"), JPEG)).toBeNull();
  });

  it("beyan uygun ama içerik resim değilse reddedilir (yeniden adlandırılmış dosya)", () => {
    expect(avatarSourceError(file("image/png", "foto.png"), PDF)).toBe(AVATAR_TYPE_ERROR);
    expect(avatarSourceError(file("", "foto.jpg"), GIF)).toBe(AVATAR_TYPE_ERROR);
    expect(avatarSourceError(file("", "IMG_1234"), HEIC)).toBe(AVATAR_TYPE_ERROR);
  });

  it("başka tür bildirilmişse reddedilir", () => {
    expect(avatarSourceError(file("image/gif", "a.gif"), GIF)).toBe(AVATAR_TYPE_ERROR);
    expect(avatarSourceError(file("video/mp4", "a.mp4"), PNG)).toBe(AVATAR_TYPE_ERROR);
  });

  it("20 MB üstü reddedilir", () => {
    expect(avatarSourceError(file("image/png", "a.png", 21 * 1024 * 1024), PNG)).toBe("Fotoğraf en fazla 20 MB olabilir.");
  });

  it("hata metni", () => {
    expect(AVATAR_TYPE_ERROR).toBe("Yalnızca JPG, PNG veya WebP yükleyebilirsiniz.");
  });
});

describe("avatarPath / centerSquare", () => {
  it("kullanıcı klasöründe, zamana göre benzersiz ad", () => {
    expect(avatarPath("u1", "image/webp", 1700)).toBe("u1/1700.webp");
    expect(avatarPath("u1", "image/jpeg", 1700)).toBe("u1/1700.jpg");
    expect(avatarPath("u1", "image/png", 1700)).toBe("u1/1700.png");
  });

  it("ortadan en büyük kare", () => {
    expect(centerSquare(4000, 3000)).toEqual({ sx: 500, sy: 0, size: 3000 });
    expect(centerSquare(1080, 1920)).toEqual({ sx: 0, sy: 420, size: 1080 });
    expect(centerSquare(512, 512)).toEqual({ sx: 0, sy: 0, size: 512 });
  });
});

describe("görünen ad", () => {
  it.each([
    ["Kamil C.", null],
    ["  Ali   Veli  ", null],
    ["A", "En az 2 karakter yaz."],
    ["a".repeat(31), "En fazla 30 karakter olabilir."],
    ["<b>Ali</b>", "Adda < ve > kullanılamaz."],
  ])("%j → %j", (name, error) => {
    expect(displayNameError(name)).toBe(error);
  });

  it("öneri giriş sağlayıcısının adından; e-posta kullanılmaz", () => {
    expect(suggestedDisplayName({ full_name: "  Kamil   Jafarov " })).toBe("Kamil Jafarov");
    expect(suggestedDisplayName({ name: "Ali" })).toBe("Ali");
    expect(suggestedDisplayName({ email: "kamil@example.com" })).toBe("");
    expect(suggestedDisplayName(undefined)).toBe("");
  });

  it("baş harf Türkçe kurala göre büyütülür", () => {
    expect(initialOf("ismail")).toBe("İ");
    expect(initialOf(null, "g")).toBe("G");
  });
});
