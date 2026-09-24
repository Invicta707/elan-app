import Link from "next/link";
import type { ReactNode } from "react";
import { FOCUS_PARAM } from "../lib/search";

type FeedHeaderProps = {
  /** Hangi sekmenin etkin olduğu; "sell" ve "my-listings" hiçbir sekmeyi etkin göstermez */
  activeTab?: "feed" | "search" | "sell" | "my-listings";
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
        className={`mx-auto grid h-14 grid-cols-[1fr_auto_1fr] items-center px-3 ${
          overlay ? "max-w-[calc(100dvh*9/16)]" : "max-w-5xl"
        }`}
      >
        <Link
          href="/"
          aria-label="Elan ana sayfa"
          className={`pointer-events-auto justify-self-start rounded-sm px-1 text-[1.6rem] font-extrabold leading-none tracking-[0.01em] [font-family:var(--font-display)] ${focusRing(overlay)}`}
        >
          Elan
        </Link>

        <nav aria-label="Ana gezinme" className="pointer-events-auto flex items-center gap-6">
          <Tab href="/" active={activeTab === "feed"} overlay={overlay}>
            Akış
          </Tab>
          <Tab href="/search" active={activeTab === "search"} overlay={overlay}>
            Ara
          </Tab>
        </nav>

        <div className="flex items-center justify-self-end gap-2">
          {activeTab !== "sell" && (
            <Link
              href="/sell"
              className={`pointer-events-auto inline-flex h-11 items-center rounded-full px-4 text-[15px] font-semibold ${
                overlay
                  ? "border border-white/40 bg-black/35 text-white"
                  : "border border-[#15181C] bg-white text-[#15181C]"
              } ${focusRing(overlay)}`}
            >
              + İlan Ver
            </Link>
          )}

          {activeTab === "feed" && (
            // Hızlı arama: arama sayfasını, arama kutusu odaklanmış hâlde açar
            <Link
              href={`/search?${FOCUS_PARAM}=1`}
              aria-label="Marka veya model ara"
              className={`pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
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