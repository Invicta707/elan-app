import type { Metadata } from "next";
import ModerationView from "../../../components/ModerationView";
import { bodyFont, displayFont } from "../../fonts";

export const metadata: Metadata = {
  title: "Moderasyon | gözüyle yönetim",
  robots: { index: false, follow: false },
};

// Oturum tarayıcıda (localStorage) tutulduğu için sayfa sunucuda yetki bilemez.
// Veriyi yalnızca yöneticiye veren /api/admin/reports'tur; yetkisiz kullanıcıyı
// ModerationView ana sayfaya gönderir.
export default function AdminReportsPage() {
  return (
    <main
      className={`${displayFont.variable} ${bodyFont.variable} min-h-dvh w-full bg-[#F2F3F5] text-[#15181C] [font-family:var(--font-body)]`}
    >
      <ModerationView />
    </main>
  );
}
