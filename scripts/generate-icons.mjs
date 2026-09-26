// Uygulama ikonlarını (PWA manifest, TWA, Apple, tarayıcı sekmesi) tek bir SVG
// kaynağından üretir. Çalıştırma: node scripts/generate-icons.mjs
//   → public/icons/*.png, app/favicon.ico
//
// sharp, Next.js'in görsel optimizasyonu için zaten kurulu (node_modules/sharp).
// Tasarım: gözüyle logosu (components/Logo.tsx) — #0A0A0A zemin üzerinde beyaz
// göz ve oynat simgesi. İçerik merkezdeki %80'lik daireye sığar: Android'in
// maskable ikon kırpmasında hiçbir parçası kesilmez.

import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const OUT = "public/icons";
const BACKGROUND = "#0A0A0A";

/**
 * cornerRadius: 0 = tam kare (maskable/Apple, köşeyi platform keser)
 * scale: logonun 100 birimlik çizimini 512'lik tuvale büyütme oranı
 */
function iconSvg({ cornerRadius, scale }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${cornerRadius}" fill="${BACKGROUND}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-50 -50)" fill="none">
    <path d="M 12 50 C 26 28, 74 28, 88 50 C 74 72, 26 72, 12 50 Z" stroke="#FFFFFF" stroke-width="8" stroke-linejoin="round"/>
    <polygon points="45,39 65,50 45,61" fill="#FFFFFF"/>
  </g>
</svg>`;
}

function render(svg, size) {
  return sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

const APP_ICON = { cornerRadius: 112, scale: 4 };
const FULL_BLEED = { cornerRadius: 0, scale: 4 };
// Sekme ikonu 16 piksele kadar küçülür: simge alanı daha çok doldurur
const FAVICON = { cornerRadius: 96, scale: 5 };

const ICONS = [
  // purpose "any": tarayıcıda yükleme, sekme vb. (köşeleri yuvarlak)
  { file: "icon-192.png", size: 192, design: APP_ICON },
  { file: "icon-512.png", size: 512, design: APP_ICON },
  // purpose "maskable": Android uyarlanabilir ikon (TWA), tam kare
  { file: "icon-maskable-512.png", size: 512, design: FULL_BLEED },
  // iOS ana ekran; köşeleri sistem yuvarlar
  { file: "apple-touch-icon.png", size: 180, design: FULL_BLEED },
];

mkdirSync(OUT, { recursive: true });
for (const { file, size, design } of ICONS) {
  writeFileSync(`${OUT}/${file}`, await render(iconSvg(design), size));
  console.log(`${OUT}/${file} (${size}x${size})`);
}

// favicon.ico: PNG gömülü ICO (tüm güncel tarayıcılar destekler), 16/32/48 piksel
const faviconSizes = [16, 32, 48];
const images = await Promise.all(faviconSizes.map((size) => render(iconSvg(FAVICON), size)));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // ayrılmış
header.writeUInt16LE(1, 2); // tür: ikon
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map((png, index) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(faviconSizes[index], 0); // genişlik
  entry.writeUInt8(faviconSizes[index], 1); // yükseklik
  entry.writeUInt16LE(1, 4); // renk düzlemi
  entry.writeUInt16LE(32, 6); // bit derinliği
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});
writeFileSync("app/favicon.ico", Buffer.concat([header, ...entries, ...images]));
console.log(`app/favicon.ico (${faviconSizes.join("/")})`);
