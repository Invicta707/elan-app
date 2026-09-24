import type { Metadata } from "next";
import MyListingsView from "../../components/MyListingsView";
import { bodyFont, displayFont } from "../fonts";

export const metadata: Metadata = {
  title: "İlanlarım | Elan",
  robots: { index: false },
};

export default function MyListingsPage() {
  return (
    <main
      className={`${displayFont.variable} ${bodyFont.variable} min-h-dvh w-full bg-[#F2F3F5] text-[#15181C] [font-family:var(--font-body)]`}
    >
      <MyListingsView />
    </main>
  );
}
