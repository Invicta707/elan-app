import type { Metadata } from "next";
import type { ReactNode } from "react";
import { bodyFont, displayFont } from "../fonts";

// /sell sayfası istemci bileşeni: başlık ve yazı tipleri buradan gelir.
export const metadata: Metadata = {
  title: "İlan Ver | gözüyle",
  description: "Aracının dikey videosunu yükle, birkaç adımda ilanını yayınla.",
};

export default function SellLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${displayFont.variable} ${bodyFont.variable} [font-family:var(--font-body)]`}>{children}</div>
  );
}
