"use client";

import { useRef, type KeyboardEvent } from "react";

export type FeedTab = "following" | "explore";

const TABS: readonly { key: FeedTab; label: string }[] = [
  { key: "following", label: "Takip Edilenler" },
  { key: "explore", label: "Keşfet" },
];

// Ana sayfadaki akışın üstünde, TikTok'taki gibi iki sekme: cam efektli bir
// hap içinde. ARIA sekme deseni: ok tuşlarıyla gezilir, seçili sekme odak alır.
export default function FeedTabs({
  active,
  onChange,
  panelIds,
}: {
  active: FeedTab;
  onChange: (tab: FeedTab) => void;
  /** Her sekmenin denetlediği panelin id'si */
  panelIds: Record<FeedTab, string>;
}) {
  const refs = useRef<Record<FeedTab, HTMLButtonElement | null>>({ following: null, explore: null });

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const index = TABS.findIndex((tab) => tab.key === active);
    const next =
      event.key === "Home"
        ? TABS[0]
        : event.key === "End"
          ? TABS[TABS.length - 1]
          : TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    onChange(next.key);
    refs.current[next.key]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Akış"
      onKeyDown={handleKeyDown}
      className="pointer-events-auto mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-black/35 p-1 ring-1 ring-inset ring-white/15 backdrop-blur-md"
    >
      {TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            ref={(el) => {
              refs.current[tab.key] = el;
            }}
            type="button"
            role="tab"
            id={`feed-tab-${tab.key}`}
            aria-selected={selected}
            aria-controls={panelIds[tab.key]}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            className={`h-8 whitespace-nowrap rounded-full px-3.5 text-[14px] font-semibold transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
              selected ? "bg-white text-[#15181C] shadow-[0_1px_4px_rgba(0,0,0,0.25)]" : "text-white/80 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
