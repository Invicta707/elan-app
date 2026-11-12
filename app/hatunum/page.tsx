import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { isHatunumEnabled } from "../../lib/hatunum-switch";
import { getSupabaseAdmin } from "../../lib/supabase-server";
import { HATUNUM_CONTENT } from "./content";
import HatunumView from "./HatunumView";

// Kişisel sayfa: her istekte aç/kapa bayrağı okunur (lib/hatunum-switch.ts).
// Kapalıysa (varsayılan) sitenin olağan 404'ü döner. Arama motorlarına kapalı,
// robots.txt'de Disallow, sitemap'te yok.

const mono = JetBrains_Mono({ subsets: ["latin", "latin-ext"], weight: ["400", "700"], variable: "--font-mono" });

/** Aynı istekte metadata ve sayfa bayrağı bir kez okur */
const enabledForRequest = cache(async () => {
  await connection();
  return isHatunumEnabled(getSupabaseAdmin);
});

// Başlık ve açıklama yalnızca sayfa açıkken verilir: statik `metadata` 404
// yanıtına da gömülür ve ismi sızdırırdı.
export async function generateMetadata(): Promise<Metadata> {
  if (!(await enabledForRequest())) return { robots: { index: false, follow: false } };
  return {
    title: "Zülal ❤️",
    description: "Sadece Zülal için.",
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = { themeColor: "#0d1117", viewportFit: "cover" };

export default async function HatunumPage() {
  if (!(await enabledForRequest())) notFound();
  return (
    <div className={mono.variable}>
      <HatunumView content={HATUNUM_CONTENT} />
    </div>
  );
}
