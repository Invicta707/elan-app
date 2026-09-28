import type { Metadata, Viewport } from "next";
import HomeFeed from "../components/HomeFeed";
import { isUuid } from "../lib/feed";
import { bodyFont, displayFont } from "./fonts";

export const metadata: Metadata = {
  title: "gözüyle | Videolu araç ilanları",
  description: "Araçları kısa videolarla keşfet, satıcıya tek dokunuşla WhatsApp'tan yaz.",
};

// viewport-fit=cover: iPhone'larda video çentik/ana ekran çubuğu alanına kadar uzanır;
// üst bar ve alt bilgi katmanı env(safe-area-inset-*) ile güvenli alanda kalır.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#121212",
};

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  // "Videoyu akışta izle" bağlantısından gelindiyse (/?v=<ilan-id>) akış o ilanla başlar.
  // /?feed=following "Takip Edilenler" sekmesiyle açılır (ör. girişten dönüşte).
  const { v, feed } = await searchParams;
  const initialVehicleId = isUuid(v) ? v : null;
  const initialTab = feed === "following" && !initialVehicleId ? "following" : "explore";

  return (
    <main
      // Mobilde akış alt gezinme çubuğunun üstünde biter: videonun alt kısmındaki
      // butonlar (WhatsApp, ses, Detaylar) çubuğun altında kalmaz. Masaüstünde
      // (lg) vitrin portalı: sayfa normal kayar.
      className={`${displayFont.variable} ${bodyFont.variable} relative h-[calc(100dvh-var(--bottom-nav-height))] w-full overflow-hidden bg-[#121212] text-white [font-family:var(--font-body)] lg:h-auto lg:min-h-dvh lg:overflow-visible`}
    >
      {/* key: başka bir ilanla gelindiğinde akış sıfırdan kurulur */}
      <HomeFeed key={initialVehicleId ?? "feed"} initialVehicleId={initialVehicleId} initialTab={initialTab} />
    </main>
  );
}