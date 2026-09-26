import type { Metadata } from "next";
import type { ReactNode } from "react";
import { bodyFont, displayFont } from "../fonts";

export const metadata: Metadata = {
  title: "Mesajlar | gözüyle",
  robots: { index: false, follow: false },
};

export default function MessagesLayout({ children }: { children: ReactNode }) {
  return (
    <main
      className={`${displayFont.variable} ${bodyFont.variable} min-h-dvh w-full bg-[#F2F3F5] text-[#15181C] [font-family:var(--font-body)]`}
    >
      {children}
    </main>
  );
}
