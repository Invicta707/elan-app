import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSiteUrl } from "./site-url";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveSiteUrl", () => {
  it("NEXT_PUBLIC_SITE_URL tanımlıysa o kullanılır", () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://elan.com.tr" }).href).toBe("https://elan.com.tr/");
    expect(
      resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://elan.com.tr/", VERCEL_PROJECT_PRODUCTION_URL: "elan-app.vercel.app" })
        .href,
    ).toBe("https://elan.com.tr/");
  });

  it("şemasız yazılan adrese https eklenir, boşluklar kırpılır", () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "  elan.com.tr " }).href).toBe("https://elan.com.tr/");
  });

  it("boş ya da sadece boşluk: hata yok, Vercel'in canlı alan adına düşer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const value of ["", "   "]) {
      expect(
        resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: value, VERCEL_PROJECT_PRODUCTION_URL: "elan-app.vercel.app" }).href,
      ).toBe("https://elan-app.vercel.app/");
    }
    // Boş değer "tanımlanmamış" sayılır: uyarı gerekmez
    expect(warn).not.toHaveBeenCalled();
  });

  it("bozuk değer: hata yok, uyarı basılır ve yedeğe düşer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const value of ["https://<alan-adın>", "ftp://elan.com.tr", "http://"]) {
      expect(
        resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: value, VERCEL_PROJECT_PRODUCTION_URL: "elan-app.vercel.app" }).href,
      ).toBe("https://elan-app.vercel.app/");
    }
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("Vercel önizlemesinde o deploy'un adresi (önce dal adresi)", () => {
    const vercel = {
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_PRODUCTION_URL: "elan-app.vercel.app",
      VERCEL_BRANCH_URL: "elan-app-git-feature-invicta707.vercel.app",
      VERCEL_URL: "elan-app-abc123.vercel.app",
    };
    expect(resolveSiteUrl(vercel).href).toBe("https://elan-app-git-feature-invicta707.vercel.app/");
    expect(resolveSiteUrl({ ...vercel, VERCEL_BRANCH_URL: "" }).href).toBe("https://elan-app-abc123.vercel.app/");
  });

  it("Vercel canlı ortamında projenin canlı alan adı, yoksa deploy adresi", () => {
    expect(
      resolveSiteUrl({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "elan-app.vercel.app",
        VERCEL_URL: "elan-app-abc123.vercel.app",
      }).href,
    ).toBe("https://elan-app.vercel.app/");
    expect(resolveSiteUrl({ VERCEL_ENV: "production", VERCEL_URL: "elan-app-abc123.vercel.app" }).href).toBe(
      "https://elan-app-abc123.vercel.app/",
    );
  });

  it("hiçbiri yoksa gözüyle'nin alan adı", () => {
    expect(resolveSiteUrl({}).href).toBe("https://gozuyle.com/");
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: undefined, VERCEL_URL: " " }).href).toBe("https://gozuyle.com/");
  });
});
