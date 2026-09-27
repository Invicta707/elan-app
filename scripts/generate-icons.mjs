// Uygulama ikonlarını (PWA manifest, TWA, Apple, tarayıcı sekmesi) tek bir SVG
// kaynağından üretir. Çalıştırma: node scripts/generate-icons.mjs
//   → public/icons/*.png, app/favicon.ico
//
// sharp, Next.js'in görsel optimizasyonu için zaten kurulu (node_modules/sharp).
// Tasarım: gözüyle işareti (lib/brand-mark.ts; üst çubuktaki logo ve video
// duraklatma simgesiyle aynı çizim): mat #121212 zemin üzerinde beyaz ince göz
// hattı ve oynat üçgeni. İçerik merkezdeki %80'lik daireye sığar: Android'in
// maskable ikon kırpmasında hiçbir parçası kesilmez. Node 22.6+ TypeScript'i
// tip silmeyle çalıştırır; brand-mark.ts yalnızca sabit içerir.

import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { EYE_PATH, EYE_STROKE, PLAY_POINTS, PLAY_ROUNDING } from "../lib/brand-mark.ts";

const OUT = "public/icons";
const BACKGROUND = "#121212";

/**
 * cornerRadius: 0 = tam kare (maskable/Apple, köşeyi platform keser)
 * scale: logonun 100 birimlik çizimini 512'lik tuvale büyütme oranı
 */
function iconSvg({ cornerRadius, scale, stroke }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${cornerRadius}" fill="${BACKGROUND}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-50 -50)" fill="none">
    <path d="${EYE_PATH}" stroke="#FFFFFF" stroke-width="${stroke}" stroke-linejoin="round"/>
    <polygon points="${PLAY_POINTS}" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="${PLAY_ROUNDING}" stroke-linejoin="round"/>
  </g>
</svg>`;
}

function render(svg, size) {
  return sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

const APP_ICON = { cornerRadius: 112, scale: 3.9, stroke: EYE_STROKE };
const FULL_BLEED = { cornerRadius: 0, scale: 3.9, stroke: EYE_STROKE };
// Sekme ikonu 16 piksele kadar küçülür: simge alanı daha çok doldurur, çizgi
// bu boyutta kaybolmasın diye biraz kalın
const FAVICON = { cornerRadius: 96, scale: 4.9, stroke: EYE_STROKE * 1.5 };

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
