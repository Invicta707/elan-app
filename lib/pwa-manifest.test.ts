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
      name: "Elan",
      display: "standalone",
      start_url: "/",
      theme_color: "#000000",
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
