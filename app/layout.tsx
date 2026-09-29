import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import BottomNav from "../components/BottomNav";
import UsernameOnboarding from "../components/profile/UsernameOnboarding";
import InstallPromptCapture from "../components/pwa/InstallPromptCapture";
import { currentSiteUrl } from "../lib/site-url";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // OpenGraph/canonical gibi göreli URL'ler bu adrese göre tamamlanır. Özel alan
  // adında NEXT_PUBLIC_SITE_URL (ör. https://gozuyle.com) tanımlanmalı; boş ya da
  // bozuksa build düşmez, Vercel'in alan adına düşülür (bkz. lib/site-url.ts).
  metadataBase: currentSiteUrl(),
  title: "gözüyle | Videolu araç ilanları",
  description: "Araçları kısa videolarla keşfet, satıcıya tek dokunuşla WhatsApp'tan yaz.",
  // Ana ekrana ekleme ve Play Store (TWA) paketi bu manifest'i okur
  // (public/manifest.json; ikonlar: scripts/generate-icons.mjs)
  manifest: "/manifest.json",
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { title: "gözüyle", statusBarStyle: "black" },
};

// Tarayıcı çubuğu / uygulama başlığı rengi: manifest'teki theme_color ile aynı (siyah)
export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <BottomNav />
        {/* Giriş yapmış, kullanıcı adı olmayan kullanıcıya bir kez sorulur */}
        <UsernameOnboarding />
        {/* "Uygulamayı yükle": tarayıcının kurulum olayı her sayfada yakalanır */}
        <InstallPromptCapture />
      </body>
    </html>
  );
}
