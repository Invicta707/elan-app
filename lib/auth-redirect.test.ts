import { describe, expect, it } from "vitest";
import { oauthErrorMessage, safeReturnPath } from "./auth-redirect";

describe("safeReturnPath", () => {
  it("site içi yolu sorgu ve parçasıyla korur", () => {
    expect(safeReturnPath("/sell")).toBe("/sell");
    expect(safeReturnPath("/search?marka=bmw&model=3-serisi")).toBe("/search?marka=bmw&model=3-serisi");
    expect(safeReturnPath("/?v=abc#x")).toBe("/?v=abc#x");
  });

  it("başka siteye götürebilecek değerler ana sayfaya düşer", () => {
    for (const value of [
      "https://kotu.site/",
      "//kotu.site/yol",
      "/\\kotu.site",
      "javascript:alert(1)",
      "sell",
      "",
      null,
      undefined,
    ]) {
      expect(safeReturnPath(value)).toBe("/");
    }
  });

  it("geri dönüş sayfasının kendisine dönülmez", () => {
    expect(safeReturnPath("/auth/callback")).toBe("/");
    expect(safeReturnPath("/auth/callback?code=x")).toBe("/");
  });
});

describe("oauthErrorMessage", () => {
  it("hata yoksa null", () => {
    expect(oauthErrorMessage("", "")).toBeNull();
    expect(oauthErrorMessage("?code=abc", "#access_token=x")).toBeNull();
  });

  it("iptal ve diğer hatalar (sorguda ya da parçada)", () => {
    expect(oauthErrorMessage("?error=access_denied&error_description=x", "")).toBe("Google ile giriş iptal edildi.");
    expect(oauthErrorMessage("", "#error=server_error")).toContain("tamamlanamadı");
  });
});
