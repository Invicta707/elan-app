import type { Metadata } from "next";
import AccountView from "../../components/AccountView";
import { bodyFont, displayFont } from "../fonts";

export const metadata: Metadata = {
  title: "Hesabım | gözüyle",
  description: "Hesap bilgilerin, çıkış yapma ve hesabını silme.",
  robots: { index: false },
};

export default function AccountPage() {
  return (
    <main
      className={`${displayFont.variable} ${bodyFont.variable} min-h-dvh w-full bg-[#F2F3F5] text-[#15181C] [font-family:var(--font-body)]`}
    >
      <AccountView />
    </main>
  );
}
