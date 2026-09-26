import type { Metadata } from "next";
import ShowcaseView from "../../components/showcase/ShowcaseView";
import { bodyFont, displayFont } from "../fonts";

export const metadata: Metadata = {
  title: "Vitrinim | gözüyle",
  robots: { index: false },
};

export default function MyListingsPage() {
  return (
    <main
      className={`${displayFont.variable} ${bodyFont.variable} min-h-dvh w-full bg-[#F2F3F5] text-[#15181C] [font-family:var(--font-body)]`}
    >
      <ShowcaseView />
    </main>
  );
}
