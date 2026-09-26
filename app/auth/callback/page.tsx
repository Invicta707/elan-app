import type { Metadata } from "next";
import AuthCallbackView from "../../../components/AuthCallbackView";
import { bodyFont, displayFont } from "../../fonts";

// Google ile girişin dönüş adresi (AuthModal → signInWithOAuth redirectTo).
// Supabase Auth → URL Configuration → Redirect URLs listesinde olmalı.
export const metadata: Metadata = {
  title: "Giriş yapılıyor | gözüyle",
  robots: { index: false },
};

export default function AuthCallbackPage() {
  return (
    <main
      className={`${displayFont.variable} ${bodyFont.variable} min-h-dvh w-full bg-[#F2F3F5] text-[#15181C] [font-family:var(--font-body)]`}
    >
      <AuthCallbackView />
    </main>
  );
}
