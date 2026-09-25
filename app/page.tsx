import type { Metadata, Viewport } from "next";
import FeedHeader from "../components/FeedHeader";
import VideoFeed from "../components/VideoFeed";
import { isUuid } from "../lib/feed";
import { bodyFont, displayFont } from "./fonts";

export const metadata: Metadata = {
  title: "Elan | Videolu araç ilanları",
  description: "Araçları kısa videolarla keşfet, satıcıya tek dokunuşla WhatsApp'tan yaz.",
};

// viewport-fit=cover: iPhone'larda video çentik/ana ekran çubuğu alanına kadar uzanır;
// üst bar ve alt bilgi katmanı env(safe-area-inset-*) ile güvenli alanda kalır.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
};

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  // "Videoyu akışta izle" bağlantısından gelindiyse (/?v=<ilan-id>) akış o ilanla başlar
  const { v } = await searchParams;
  const initialVehicleId = isUuid(v) ? v : null;

  return (
    <main
      // Mobilde akış alt gezinme çubuğunun üstünde biter: videonun alt kısmındaki
      // butonlar (WhatsApp, ses, Detaylar) çubuğun altında kalmaz
      className={`${displayFont.variable} ${bodyFont.variable} relative h-[calc(100dvh-var(--bottom-nav-height))] w-full overflow-hidden bg-black text-white [font-family:var(--font-body)]`}
    >
      {/* key: başka bir ilanla gelindiğinde akış sıfırdan kurulur */}
      <VideoFeed key={initialVehicleId ?? "feed"} initialVehicleId={initialVehicleId} />
      <FeedHeader />
    </main>
  );
}