import type { Metadata } from "next";
import FavoritesView from "../../components/FavoritesView";
import { bodyFont, displayFont } from "../fonts";

export const metadata: Metadata = {
  title: "Favorilerim | gözüyle",
  robots: { index: false },
};

export default function FavoritesPage() {
  return (
    <main
      className={`${displayFont.variable} ${bodyFont.variable} min-h-dvh w-full bg-[#F2F3F5] text-[#15181C] [font-family:var(--font-body)]`}
    >
      <FavoritesView />
    </main>
  );
}
