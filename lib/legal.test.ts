import { describe, expect, it } from "vitest";
import { resolveSupportEmail } from "./legal";

describe("resolveSupportEmail", () => {
  it("tanımlı adresi kullanır, boşlukları kırpar", () => {
    expect(resolveSupportEmail("iletisim@ornek.com.tr")).toBe("iletisim@ornek.com.tr");
    expect(resolveSupportEmail("  iletisim@ornek.com.tr ")).toBe("iletisim@ornek.com.tr");
  });

  it("tanımsız, boş ya da geçersiz değer varsayılana düşer", () => {
    for (const value of [undefined, "", "   ", "destek", "destek@", "@elan.app", "destek@elan", "a b@c.d"]) {
      expect(resolveSupportEmail(value)).toBe("destek@elan.app");
    }
  });
});
