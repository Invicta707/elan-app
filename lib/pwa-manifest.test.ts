import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// public/manifest.json: ana ekrana ekleme ve Play Store (TWA) paketi bunu okur.
// İkon dosyaları scripts/generate-icons.mjs ile üretilir.

type ManifestIcon = { src: string; sizes: string; type: string; purpose?: string };
const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8")) as Record<string, unknown> & {
  icons: ManifestIcon[];
};

/** PNG başlığından (IHDR) genişlik x yükseklik */
function pngSize(path: string): string {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe("PWA manifest", () => {
  it("kurulabilir uygulama için zorunlu alanlar", () => {
    expect(manifest).toMatchObject({
      name: "gözüyle",
      display: "standalone",
      start_url: "/",
      theme_color: "#0A0A0A",
    });
    expect(manifest.short_name).toBeTruthy();
  });

  it("192 ve 512 ikonları ile maskable ikon tanımlı", () => {
    const sizes = manifest.icons.map((icon) => `${icon.sizes}:${icon.purpose ?? "any"}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  });

  it("her ikon dosyası var ve boyutu manifest'tekiyle aynı", () => {
    for (const icon of manifest.icons) {
      const path = `public${icon.src}`;
      expect(existsSync(path), path).toBe(true);
      expect(icon.type).toBe("image/png");
      expect(pngSize(path), path).toBe(icon.sizes);
    }
  });
});

// public/.well-known/assetlinks.json: Android uygulaması (TWA) ile sitenin aynı
// sahibe ait olduğunu kanıtlar; doğrulanırsa uygulamada adres çubuğu görünmez.
// Parmak izi, APK/AAB'yi imzalayan sertifikanınkiyle birebir aynı olmalı.
describe("Digital Asset Links (TWA)", () => {
  const links = JSON.parse(readFileSync("public/.well-known/assetlinks.json", "utf8")) as {
    relation: string[];
    target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
  }[];

  it("Android paketi için bütün adresleri devreder", () => {
    expect(links).toHaveLength(1);
    expect(links[0].relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(links[0].target).toMatchObject({ namespace: "android_app", package_name: "com.gozuyle.twa" });
  });

  it("parmak izleri SHA-256 biçiminde (32 bayt, büyük harf, iki nokta ile ayrılmış)", () => {
    const fingerprints = links[0].target.sha256_cert_fingerprints;
    expect(fingerprints.length).toBeGreaterThan(0);
    for (const fingerprint of fingerprints) expect(fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});
