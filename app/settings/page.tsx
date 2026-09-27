import type { Metadata } from "next";
import SettingsView from "../../components/settings/SettingsView";
import { bodyFont, displayFont } from "../fonts";

export const metadata: Metadata = {
  title: "Ayarlar | gözüyle",
  description: "Hesap bilgilerin, bildirim tercihlerin, engellediğin kullanıcılar, yasal metinler ve hesabını silme.",
  robots: { index: false },
};

export default function SettingsPage() {
  return (
    <main
      className={`${displayFont.variable} ${bodyFont.variable} min-h-dvh w-full bg-[#F2F3F5] text-[#15181C] [font-family:var(--font-body)]`}
    >
      <SettingsView />
    </main>
  );
}
