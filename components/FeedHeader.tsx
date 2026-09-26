import Link from "next/link";
import type { ReactNode } from "react";
import { FOCUS_PARAM } from "../lib/search";
import Logo from "./Logo";

type FeedHeaderProps = {
  /** Hangi sekmenin etkin olduğu; "sell", "favorites" ve "my-listings" hiçbir metin sekmesini etkin göstermez */
  activeTab?: "feed" | "search" | "sell" | "favorites" | "my-listings";
  /**
   * overlay: dikey videonun üstünde, yarı saydam (ana sayfa)
   * solid: açık zeminli sayfalarda normal akışta (arama sayfası)
   */
  tone?: "overlay" | "solid";
};

// Kancasız (hook'suz) bir bileşen: hem sunucu hem istemci bileşenlerinin içinde kullanılabilir.
export default function FeedHeader({ activeTab = "feed", tone = "overlay" }: FeedHeaderProps) {
  const overlay = tone === "overlay";

  return (
    <header
      className={
        overlay
          ? "pointer-events-none absolute inset-x-0 top-0 z-30 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.6)_0%,rgba(0,0,0,0.25)_60%,rgba(0,0,0,0)_100%)] pt-[env(safe-area-inset-top)] pb-3 text-white"
          : "pt-[env(safe-area-inset-top)] text-[#15181C]"
      }
    >
      {/* Üstteki video sütunuyla aynı genişlikte; masaüstünde ortalanır */}
      <div
        className={`@container mx-auto grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-x-3 px-3 ${
          overlay ? "max-w-[calc(100dvh*9/16)]" : "max-w-5xl"
        }`}
      >
        <Link
          href="/"
          aria-label="gözüyle ana sayfa"
          className={`pointer-events-auto justify-self-start rounded-sm px-1 leading-none [font-family:var(--font-display)] ${focusRing(overlay)}`}
        >
          {/* Renk verilmez: başlığın rengini alır (akışta beyaz, açık sayfalarda koyu).
              En dar başlıkta yazı gizlenir, göz simgesi kalır (erişilebilir ad aria-label'da). */}
          <Logo className="h-7" textClassName="@max-[16.5rem]:hidden" />
        </Link>

        <nav aria-label="Ana gezinme" className="pointer-events-auto flex items-center gap-6">
          <Tab href="/" active={activeTab === "feed"} overlay={overlay}>
            Akış
          </Tab>
          <Tab href="/search" active={activeTab === "search"} overlay={overlay}>
            Ara
          </Tab>
        </nav>

        {/* Akışta başlık video genişliğinde (kısa pencerede dar) ve sekmelerin
            ortada kalması için yan sütunlar alanı eşit paylaşır. Sağ sütun bu
            yüzden genişliğe göre küçülür (eşikler logo + sekmeler + butonların
            ölçülmüş genişliğine göre): dar başlıkta "İlan Ver" yuvarlak "+"
            ikonuna döner; masaüstünde ≈700px'ten kısa pencerede kalp, ≈600px'ten
            kısada arama kısayolu, ≈510px'ten kısada logonun yazısı gizlenir.
            Butonlar asla alt satıra kırılmaz. Mobilde kalp ve "İlan Ver" alt gezinme çubuğunda. */}
        <div className="flex items-center justify-self-end gap-2">
          <Link
            href="/favorites"
            aria-label="Favorilerim"
            aria-current={activeTab === "favorites" ? "page" : undefined}
            className={`pointer-events-auto hidden h-11 w-11 shrink-0 items-center justify-center rounded-full md:@min-[23rem]:flex ${
              overlay ? "bg-black/35" : "bg-white"
            } ${focusRing(overlay)}`}
          >
            <HeartIcon
              filled={activeTab === "favorites"}
              className={`h-5 w-5 ${activeTab === "favorites" && !overlay ? "text-[#E5484D]" : ""}`}
            />
          </Link>

          {activeTab !== "sell" && (
            <Link
              href="/sell"
              // Metin dar başlıkta gizlendiği için ad her iki hâlde de buradan gelir
              aria-label="İlan Ver"
              className={`pointer-events-auto hidden h-11 w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full text-[15px] font-semibold md:inline-flex @min-[32.5rem]:w-auto @min-[32.5rem]:px-4 ${
                overlay
                  ? "border border-white/40 bg-black/35 text-white"
                  : "border border-[#15181C] bg-white text-[#15181C]"
              } ${focusRing(overlay)}`}
            >
              <PlusIcon className="h-5 w-5 @min-[32.5rem]:hidden" />
              <span className="hidden @min-[32.5rem]:inline">+ İlan Ver</span>
            </Link>
          )}

          {activeTab === "feed" && (
            // Hızlı arama: arama sayfasını, arama kutusu odaklanmış hâlde açar.
            // Masaüstünde "+" ile birlikte sığmayınca gizlenir; "Ara" sekmesi aynı
            // sayfaya gider. Mobilde sağda tek buton olduğu için hep görünür.
            <Link
              href={`/search?${FOCUS_PARAM}=1`}
              aria-label="Marka veya model ara"
              className={`pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full md:@max-[19.75rem]:hidden ${
                overlay ? "bg-black/35" : "bg-white"
              } ${focusRing(overlay)}`}
            >
              <SearchIcon className="h-5 w-5" />
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function Tab({
  href,
  active,
  overlay,
  children,
}: {
  href: string;
  active: boolean;
  overlay: boolean;
  children: ReactNode;
}) {
  const idle = overlay ? "text-white/70" : "text-[#5B616B]";
  const bar = overlay ? "bg-white" : "bg-[#003399]";

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex h-11 items-center rounded-sm px-1 text-[17px] ${
        active ? "font-semibold" : `font-medium ${idle}`
      } ${focusRing(overlay)}`}
    >
      {children}
      {active && (
        <span
          aria-hidden="true"
          className={`absolute inset-x-1 bottom-1.5 h-[2.5px] rounded-full ${bar}`}
        />
      )}
    </Link>
  );
}

function focusRing(overlay: boolean) {
  return overlay
    ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
    : "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]";
}

function HeartIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 20.5s-7.5-4.6-9.2-9.4A5.1 5.1 0 0 1 12 6.6a5.1 5.1 0 0 1 9.2 4.5C19.5 15.9 12 20.5 12 20.5Z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}