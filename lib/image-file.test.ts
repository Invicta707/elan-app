import { describe, expect, it } from "vitest";
import {
  IMAGE_SIGNATURE_BYTES,
  IMAGE_TYPE_ERROR,
  acceptedImageType,
  declaredImageSource,
  detectImageType,
  fileExtension,
  normalizeMimeType,
} from "./image-file";

// Profil fotoğrafı ve ilan fotoğraflarının ortak tür kuralları.

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])));

// Gerçek dosyaların ilk baytları
const PNG = bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, "JFIF");
const WEBP = bytes("RIFF", 0, 0, 0, 0, "WEBP", "VP8 ");
const GIF = bytes("GIF89a", 0, 0, 0, 0, 0, 0);
const HEIC = bytes(0, 0, 0, 0x18, "ftypheic");
const PDF = bytes("%PDF-1.7", 0, 0, 0, 0);

describe("detectImageType", () => {
  it("türü ilk baytlardan tanır (uzantıya güvenmez): PNG, JPEG, WebP", () => {
    expect(detectImageType(WEBP)).toBe("image/webp");
    expect(detectImageType(JPEG)).toBe("image/jpeg");
    expect(detectImageType(PNG)).toBe("image/png");
  });

  it("başka her şey null", () => {
    expect(detectImageType(bytes(0x89, "PNG", 0x0d, 0x0a))).toBeNull(); // yarım PNG imzası
    expect(detectImageType(bytes(0x89, "PNX", 0x0d, 0x0a, 0x1a, 0x0a))).toBeNull();
    expect(detectImageType(GIF)).toBeNull();
    expect(detectImageType(HEIC)).toBeNull();
    expect(detectImageType(PDF)).toBeNull();
    expect(detectImageType(bytes("<svg xmlns"))).toBeNull();
    expect(detectImageType(bytes("RIFF", 0, 0, 0, 0, "WAVE"))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });

  it("imza okumak için yeterli bayt sayısı", () => {
    for (const head of [PNG, JPEG, WEBP]) expect(detectImageType(head.subarray(0, IMAGE_SIGNATURE_BYTES))).not.toBeNull();
  });
});

describe("seçilen dosyanın beyan edilen türü", () => {
  it("MIME türü büyük/küçük harf ve parametreden bağımsız", () => {
    expect(normalizeMimeType("IMAGE/PNG")).toBe("image/png");
    expect(normalizeMimeType(" image/png; charset=binary ")).toBe("image/png");
    expect(normalizeMimeType(undefined)).toBe("");
  });

  it("uzantı küçük harfe çevrilir; yoksa boş", () => {
    expect(fileExtension("Foto.JPEG")).toBe("jpeg");
    expect(fileExtension("arsiv.tar.png")).toBe("png");
    expect(fileExtension("IMG_1234")).toBe("");
    expect(fileExtension(null)).toBe("");
  });

  it.each([
    ["image/png", "a.png"],
    ["image/x-png", "a.png"],
    ["IMAGE/PNG", "a.png"],
    ["Image/Png", "a"],
    ["image/jpeg", "a.jpg"],
    ["image/jpg", "a.jpg"],
    ["image/pjpeg", "a.jpg"],
    ["image/webp", "a.webp"],
    ["IMAGE/WEBP", "a.WEBP"],
  ])("%s kabul edilir (%s)", (type, name) => {
    expect(declaredImageSource({ type, name })).toBe("allowed");
  });

  it.each([
    ["", "IMG_1.png"],
    ["", "IMG_1.JPG"],
    ["", "foto.jpeg"],
    ["application/octet-stream", "foto.webp"],
    ["application/octet-stream", "FOTO.PNG"],
    ["binary/octet-stream", "foto.jpg"],
  ])("tür bildirilmezse (%j) uzantıya bakılır: %s", (type, name) => {
    expect(declaredImageSource({ type, name })).toBe("allowed");
  });

  it("tür de uzantı da yoksa karar ilk baytlara kalır", () => {
    expect(declaredImageSource({ type: "", name: "IMG_1234" })).toBe("unknown");
    expect(declaredImageSource({ type: "application/octet-stream", name: "" })).toBe("unknown");
  });

  it.each([
    ["image/gif", "a.gif"],
    ["image/heic", "a.heic"],
    ["video/mp4", "a.mp4"],
    ["application/pdf", "a.pdf"],
    ["image/svg+xml", "a.svg"],
    ["", "a.gif"],
    ["application/octet-stream", "a.heic"],
  ])("başka tür reddedilir: %s (%s)", (type, name) => {
    expect(declaredImageSource({ type, name })).toBe("rejected");
  });
});

describe("acceptedImageType: gerçek tür yalnızca imzadan", () => {
  it.each([
    ["image/x-png", "foto.png", PNG, "image/png"],
    ["IMAGE/PNG", "FOTO.PNG", PNG, "image/png"],
    ["image/pjpeg", "foto.jpg", JPEG, "image/jpeg"],
    ["image/jpg", "foto.jpg", JPEG, "image/jpeg"],
    ["image/webp", "foto.webp", WEBP, "image/webp"],
    ["", "IMG_1.png", PNG, "image/png"],
    ["application/octet-stream", "IMG_2.WEBP", WEBP, "image/webp"],
    ["", "IMG_1234", JPEG, "image/jpeg"],
    // Beyan ile içerik uyuşmazsa içerik geçerli: .png adlı JPEG, JPEG olarak yüklenir
    ["image/png", "foto.png", JPEG, "image/jpeg"],
  ] as const)("%j %s → %s", (type, name, head, expected) => {
    expect(acceptedImageType({ type, name }, head)).toBe(expected);
  });

  it.each([
    ["image/png", "foto.png", PDF],
    ["", "foto.jpg", GIF],
    ["", "IMG_1234", HEIC],
    ["image/gif", "a.gif", GIF],
    ["video/mp4", "a.mp4", PNG],
  ] as const)("reddedilir: %j %s", (type, name, head) => {
    expect(acceptedImageType({ type, name }, head)).toBeNull();
  });

  it("hata metni", () => {
    expect(IMAGE_TYPE_ERROR).toBe("Yalnızca JPG, PNG veya WebP yükleyebilirsiniz.");
  });
});
