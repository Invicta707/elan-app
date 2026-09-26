"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { bodyFont } from "../app/fonts";
import { NAV_ITEMS, isNavItemActive, type NavItemKey } from "../lib/navigation";
import AuthGatedLink from "./AuthGatedLink";

// Mobil alt gezinme çubuğu (md ve üstünde gizli). Yüksekliği app/globals.css'teki
// --bottom-nav-height ile aynıdır: sayfalar alt boşluklarını ve akış
// yüksekliğini bu değişkenle ayarlar.
export default function BottomNav() {
  const pathname = usePathname();
  // Siyah video akışının üstünde koyu, açık zeminli sayfalarda açık tonda
  const dark = pathname === "/";

  return (
    <nav
      aria-label="Alt gezinme"
      className={`${bodyFont.variable} fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] [font-family:var(--font-body)] md:hidden ${
        dark ? "border-white/10 bg-black" : "border-[#E3E6EA] bg-white/95 backdrop-blur-[6px]"
      }`}
    >
      {/* 1px üst kenarlıkla birlikte tam 4rem: --bottom-nav-height ile aynı */}
      <ul className="mx-auto grid h-[calc(4rem-1px)] max-w-lg grid-cols-5">
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(item.href, pathname);
          const className = `flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${
            dark ? "focus-visible:ring-white" : "focus-visible:ring-[#003399]"
          } ${toneFor(active, dark)}`;

          if (item.key === "sell") {
            // Misafirde giriş penceresini açar, giriş yapılınca ilan formuna geçer
            return (
              <li key={item.key} className="flex">
                <AuthGatedLink href={item.href} aria-current={active ? "page" : undefined} className={className}>
                  <span
                    className={`flex h-9 w-11 items-center justify-center rounded-xl bg-[#003399] text-white shadow-[0_2px_8px_rgba(0,51,153,0.35)] ${
                      active
                        ? `ring-2 ring-offset-2 ${dark ? "ring-white ring-offset-black" : "ring-[#003399] ring-offset-white"}`
                        : ""
                    }`}
                  >
                    <PlusIcon className="h-5 w-5" />
                  </span>
                  <span>{item.label}</span>
                </AuthGatedLink>
              </li>
            );
          }

          return (
            <li key={item.key} className="flex">
              <Link href={item.href} aria-current={active ? "page" : undefined} className={className}>
                <NavIcon itemKey={item.key} active={active} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function toneFor(active: boolean, dark: boolean): string {
  if (active) return dark ? "text-white" : "text-[#003399]";
  return dark ? "text-white/60" : "text-[#5B616B]";
}

type IconProps = { className?: string };

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function NavIcon({ itemKey, active }: { itemKey: NavItemKey; active: boolean }) {
  // Etkin sekmede çizgi kalınlaşır: renk dışında ikinci bir işaret
  const strokeWidth = active ? 2.4 : 1.9;
  const className = "h-6 w-6";
  switch (itemKey) {
    case "feed":
      return <CompassIcon className={className} strokeWidth={strokeWidth} />;
    case "search":
      return <SearchIcon className={className} strokeWidth={strokeWidth} />;
    case "favorites":
      // Etkin sekmede kalbin içi de dolar
      return <HeartIcon className={className} strokeWidth={strokeWidth} filled={active} />;
    default:
      return <CarIcon className={className} strokeWidth={strokeWidth} />;
  }
}

function CompassIcon({ className, strokeWidth }: IconProps & { strokeWidth: number }) {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps} strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </svg>
  );
}

function SearchIcon({ className, strokeWidth }: IconProps & { strokeWidth: number }) {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps} strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

function HeartIcon({ className, strokeWidth, filled }: IconProps & { strokeWidth: number; filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      {...strokeProps}
      fill={filled ? "currentColor" : "none"}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden="true"
    >
      <path d="M12 20.5s-7.5-4.6-9.2-9.4A5.1 5.1 0 0 1 12 6.6a5.1 5.1 0 0 1 9.2 4.5C19.5 15.9 12 20.5 12 20.5Z" />
    </svg>
  );
}

function CarIcon({ className, strokeWidth }: IconProps & { strokeWidth: number }) {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps} strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <path d="M5 16.5h14M4.5 16.5v-3.2l1.8-4.6A2 2 0 0 1 8.2 7.5h7.6a2 2 0 0 1 1.9 1.2l1.8 4.6v3.2" />
      <path d="M4.5 13.3h15" />
      <path d="M6.5 16.5v1.5M17.5 16.5v1.5" />
      <circle cx="8" cy="15" r="0.6" fill="currentColor" />
      <circle cx="16" cy="15" r="0.6" fill="currentColor" />
    </svg>
  );
}

function PlusIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps} strokeWidth={2.6} className={className} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
