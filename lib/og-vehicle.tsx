import type { ReactElement } from "react";
import { EYE_PATH, EYE_STROKE, PLAY_POINTS, PLAY_ROUNDING } from "./brand-mark";
import { formatAmount } from "./search";
import type { VehiclePageData } from "./vehicle-page";

// İlan paylaşım afişi (OpenGraph / Twitter, 1200×630): WhatsApp ve sosyal
// medyada ilan bağlantısı araca özel bir kartla görünür. Rota
// app/api/og/vehicle/[id]/route.tsx; bu dosya satori (next/og) için JSX'i ve
// yardımcıları tutar, UI'dan bağımsız ve test edilebilir.
//
// Düzen: arka planda ilanın kapak fotoğrafı (yoksa video karesi), soldan
// sağa açılan koyu örtüyle; solda başlık, büyük fiyat plakası ve Yıl / KM /
// İl hapları; sağda dikey video kartı (videonun karesi, ortada göz-oynat
// işareti); sağ üstte gözüyle logosu. satori yalnızca flex ve satır içi stil
// bilir; görseller önceden indirilip data: adresi olarak verilir.

export const OG_SIZE = { width: 1200, height: 630 } as const;
/** CDN'de bir gün, tarayıcıda bir saat; sonra arka planda yenilenir */
export const OG_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

/** Görsel indirme sınırları: afiş birkaç saniyede çizilsin */
const IMAGE_TIMEOUT_MS = 4000;
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const FONT_TIMEOUT_MS = 3000;

export type OgVehicle = Pick<VehiclePageData, "brandName" | "modelName" | "year" | "mileageKm" | "city" | "price" | "currency"> & {
  isTest: boolean;
};

export type OgImages = {
  /** Arka plan: kapak fotoğrafı ya da video karesi (data: adresi) */
  background: string | null;
  /** Dikey video kartı: videonun karesi (data: adresi) */
  poster: string | null;
};

const DISPLAY = "Barlow Condensed";
const BODY = "Barlow";

export function ogTitle(v: Pick<OgVehicle, "brandName" | "modelName">): string {
  return `${v.brandName} ${v.modelName}`.trim();
}

export function ogFacts(v: Pick<OgVehicle, "year" | "mileageKm" | "city">): string[] {
  return [String(v.year), `${formatAmount(v.mileageKm)} km`, v.city ?? ""].filter(Boolean);
}

/** Fiyat plakasındaki metin: "1.450.000 TL" (TRY dışı para biriminde kodu) */
export function ogPrice(v: Pick<OgVehicle, "price" | "currency">): string {
  return `${formatAmount(v.price)} ${v.currency === "TRY" ? "TL" : v.currency}`;
}

/** Afişte geçen bütün yazılar: yazı tipi yalnızca bu harflerle indirilir */
export function ogText(v: OgVehicle): string {
  return [ogTitle(v), ...ogFacts(v), ogPrice(v), "gözüyle", "TEST İLANI", "Videolu ilan"].join(" ");
}

/** Afiş görselleri: arka plan fotoğraf (yatay, jpeg/png) ya da video karesi; kart video karesi */
export function ogImageSources(v: Pick<VehiclePageData, "photoUrls" | "videoThumbnailUrl">): {
  background: string | null;
  poster: string | null;
} {
  const photo = v.photoUrls.find((url) => /\.(jpe?g|png)(\?|$)/i.test(url)) ?? null;
  const frame = (height: number) => {
    if (!v.videoThumbnailUrl) return null;
    try {
      const url = new URL(v.videoThumbnailUrl);
      url.searchParams.set("height", String(height));
      return url.toString();
    } catch {
      return null;
    }
  };
  return { background: photo ?? frame(630), poster: frame(480) ?? photo };
}

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Görseli indirip data: adresine çevirir; yalnızca JPEG/PNG (satori), sınırı aşan ya da hatalı olan null */
export async function fetchImageDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetchWithTimeout(url, IMAGE_TIMEOUT_MS);
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "image/jpeg" && type !== "image/png") return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_MAX_BYTES) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

type OgFont = { name: string; data: ArrayBuffer; weight: 500 | 600 | 700; style: "normal" };

/**
 * Uygulamanın yazı tipleri (Barlow Condensed 700, Barlow 500/600), yalnızca
 * afişteki harflerle Google Fonts'tan (TTF). İndirilemezse boş liste: afiş
 * varsayılan yazı tipiyle çizilir (₺ yerine plakadaki simge zaten çizim).
 */
export async function loadOgFonts(text: string): Promise<OgFont[]> {
  const wanted: { family: string; name: string; weight: OgFont["weight"] }[] = [
    { family: "Barlow+Condensed:wght@700", name: DISPLAY, weight: 700 },
    { family: "Barlow:wght@500", name: BODY, weight: 500 },
    { family: "Barlow:wght@600", name: BODY, weight: 600 },
  ];
  const fonts = await Promise.all(
    wanted.map(async ({ family, name, weight }) => {
      try {
        const css = await (
          await fetchWithTimeout(`https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`, FONT_TIMEOUT_MS)
        ).text();
        const src = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
        if (!src) return null;
        const response = await fetchWithTimeout(src, FONT_TIMEOUT_MS);
        if (!response.ok) return null;
        return { name, data: await response.arrayBuffer(), weight, style: "normal" as const };
      } catch {
        return null;
      }
    }),
  );
  return fonts.filter((font): font is OgFont => font !== null);
}

/** Lira simgesi (₺) çizim olarak: yazı tipinde olmasa da görünür */
function LiraMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 3v17.5c4.8 0 8.5-3.2 8.5-8" />
      <path d="M5.5 11.5l8.5-3.5" />
      <path d="M5.5 15.5l8.5-3.5" />
    </svg>
  );
}

function EyeMark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <path d={EYE_PATH} stroke={color} strokeWidth={EYE_STROKE} strokeLinejoin="round" />
      <polygon points={PLAY_POINTS} fill={color} stroke={color} strokeWidth={PLAY_ROUNDING} strokeLinejoin="round" />
    </svg>
  );
}

export function VehicleOgImage({ vehicle, images }: { vehicle: OgVehicle; images: OgImages }): ReactElement {
  const title = ogTitle(vehicle);
  const facts = ogFacts(vehicle);
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        backgroundColor: "#121212",
        color: "#FFFFFF",
        fontFamily: BODY,
      }}
    >
      {images.background && (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
        <img
          src={images.background}
          width={OG_SIZE.width}
          height={OG_SIZE.height}
          style={{ position: "absolute", left: 0, top: 0, width: OG_SIZE.width, height: OG_SIZE.height, objectFit: "cover" }}
        />
      )}
      {/* Yazıların okunması için soldan sağa koyulaşan örtü */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: OG_SIZE.width,
          height: OG_SIZE.height,
          backgroundImage: "linear-gradient(90deg, rgba(10,10,10,0.95) 0%, rgba(10,10,10,0.86) 48%, rgba(10,10,10,0.55) 100%)",
        }}
      />

      {/* Sol: başlık, fiyat plakası, haplar */}
      <div
        style={{
          position: "absolute",
          left: 72,
          top: 0,
          width: 700,
          height: OG_SIZE.height,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {vehicle.isTest && (
          <div style={{ display: "flex" }}>
            <div
              style={{
                display: "flex",
                padding: "6px 16px",
                borderRadius: 999,
                backgroundColor: "rgba(255,255,255,0.14)",
                border: "2px solid rgba(255,255,255,0.28)",
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: 2,
                marginBottom: 20,
              }}
            >
              TEST İLANI
            </div>
          </div>
        )}
        <div
          style={{
            display: "flex",
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: title.length > 22 ? 72 : 88,
            lineHeight: 1.02,
            letterSpacing: -0.5,
          }}
        >
          {title}
        </div>

        <div style={{ display: "flex", marginTop: 30 }}>
          <div
            style={{
              display: "flex",
              height: 96,
              borderRadius: 10,
              border: "4px solid #000000",
              backgroundColor: "#FFFFFF",
              overflow: "hidden",
              boxShadow: "0 6px 0 rgba(0,0,0,0.45)",
            }}
          >
            <div style={{ display: "flex", width: 58, alignItems: "center", justifyContent: "center", backgroundColor: "#003399" }}>
              <LiraMark size={34} />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "0 26px",
                color: "#000000",
                fontFamily: DISPLAY,
                fontWeight: 700,
                fontSize: 68,
                letterSpacing: 0.5,
              }}
            >
              {ogPrice(vehicle)}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", marginTop: 30 }}>
          {facts.map((fact) => (
            <div
              key={fact}
              style={{
                display: "flex",
                padding: "8px 20px",
                marginRight: 12,
                borderRadius: 999,
                backgroundColor: "rgba(0,0,0,0.45)",
                border: "2px solid rgba(255,255,255,0.22)",
                fontSize: 30,
                fontWeight: 500,
              }}
            >
              {fact}
            </div>
          ))}
        </div>
      </div>

      {/* Sağ üst: logo */}
      <div style={{ position: "absolute", right: 72, top: 36, display: "flex", alignItems: "center" }}>
        <EyeMark size={52} color="#FFFFFF" />
        <div style={{ display: "flex", marginLeft: 10, fontSize: 38, fontWeight: 600, letterSpacing: -0.5 }}>gözüyle</div>
      </div>

      {/* Sağ: dikey video kartı */}
      <div
        style={{
          position: "absolute",
          right: 84,
          top: 118,
          width: 262,
          height: 466,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 26,
          overflow: "hidden",
          backgroundColor: "#18181B",
          border: "3px solid rgba(255,255,255,0.9)",
          boxShadow: "0 18px 40px rgba(0,0,0,0.55)",
        }}
      >
        {images.poster && (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img
            src={images.poster}
            width={262}
            height={466}
            style={{ position: "absolute", left: 0, top: 0, width: 262, height: 466, objectFit: "cover" }}
          />
        )}
        <div style={{ display: "flex", opacity: 0.92 }}>
          <EyeMark size={96} color="#FFFFFF" />
        </div>
        <div
          style={{
            position: "absolute",
            left: 16,
            bottom: 16,
            display: "flex",
            padding: "4px 12px",
            borderRadius: 999,
            backgroundColor: "rgba(0,0,0,0.6)",
            fontSize: 20,
            fontWeight: 600,
          }}
        >
          Videolu ilan
        </div>
      </div>
    </div>
  );
}
