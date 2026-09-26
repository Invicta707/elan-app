import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import { avatarPath, centerSquare, detectAvatarType } from "./avatar";
import { displayNameError, initialOf, suggestedDisplayName } from "./profile";

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])));

describe("detectAvatarType", () => {
  it("türü ilk baytlardan tanır (uzantıya güvenmez)", () => {
    expect(detectAvatarType(bytes("RIFF", 0, 0, 0, 0, "WEBP", "VP8 "))).toBe("image/webp");
    expect(detectAvatarType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectAvatarType(bytes(0x89, "PNG", 0x0d, 0x0a))).toBeNull();
    expect(detectAvatarType(bytes("<svg xmlns"))).toBeNull();
    expect(detectAvatarType(bytes("RIFF", 0, 0, 0, 0, "WAVE"))).toBeNull();
    expect(detectAvatarType(new Uint8Array())).toBeNull();
  });
});

describe("avatarPath / centerSquare", () => {
  it("kullanıcı klasöründe, zamana göre benzersiz ad", () => {
    expect(avatarPath("u1", "image/webp", 1700)).toBe("u1/1700.webp");
    expect(avatarPath("u1", "image/jpeg", 1700)).toBe("u1/1700.jpg");
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
