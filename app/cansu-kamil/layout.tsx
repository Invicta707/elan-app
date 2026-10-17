import type { Metadata, Viewport } from "next";

// Kişisel sürpriz sayfası: arama motorlarına kapalı, sitemap'te yok (app/sitemap.ts
// yalnızca sabit sayfaları ve ilanları listeler). Sayfa "use client" olduğundan
// metadata ve viewport buradan verilir.
export const metadata: Metadata = {
  title: "Güzeller güzeli Cansu 💖",
  description: "Sadece Cansu için.",
  robots: { index: false, follow: false },
};

// viewport-fit=cover: iPhone'da env(safe-area-inset-*) değerleri ancak böyle dolar
export const viewport: Viewport = {
  themeColor: "#14040c",
  viewportFit: "cover",
};

export default function CansuKamilLayout({ children }: LayoutProps<"/cansu-kamil">) {
  return children;
}
