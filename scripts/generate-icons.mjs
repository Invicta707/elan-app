// Uygulama ikonlarını (PWA manifest, TWA, Apple) tek bir SVG kaynağından üretir.
// Çalıştırma: node scripts/generate-icons.mjs  → public/icons/*.png
//
// sharp, Next.js'in görsel optimizasyonu için zaten kurulu (node_modules/sharp).
// Tasarım: siyah zemin, beyaz "E"; orta kol kırmızı oynat üçgeni (video).
// İçerik merkezdeki %80'lik daireye sığar: Android'in maskable ikon kırpmasında
// hiçbir parçası kesilmez.

import { mkdirSync } from "node:fs";
import sharp from "sharp";

const OUT = "public/icons";

/** cornerRadius: 0 = tam kare (maskable/Apple, köşeyi platform keser) */
function iconSvg(cornerRadius) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${cornerRadius}" fill="#000000"/>
  <g fill="#FFFFFF">
    <rect x="164" y="148" width="54" height="216" rx="10"/>
    <rect x="164" y="148" width="184" height="52" rx="10"/>
    <rect x="164" y="312" width="184" height="52" rx="10"/>
  </g>
  <path d="M238 224 L238 288 L318 256 Z" fill="#E5484D" stroke="#E5484D" stroke-width="12" stroke-linejoin="round"/>
</svg>`;
}

const ICONS = [
  // purpose "any": tarayıcıda yükleme, sekme vb. (köşeleri yuvarlak)
  { file: "icon-192.png", size: 192, radius: 112 },
  { file: "icon-512.png", size: 512, radius: 112 },
  // purpose "maskable": Android uyarlanabilir ikon (TWA), tam kare
  { file: "icon-maskable-512.png", size: 512, radius: 0 },
  // iOS ana ekran; köşeleri sistem yuvarlar
  { file: "apple-touch-icon.png", size: 180, radius: 0 },
];

mkdirSync(OUT, { recursive: true });
for (const { file, size, radius } of ICONS) {
  await sharp(Buffer.from(iconSvg(radius)), { density: 300 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}/${file}`);
  console.log(`${OUT}/${file} (${size}x${size})`);
}
