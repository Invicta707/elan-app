"use client";

import { useRef, type KeyboardEvent } from "react";

export type FeedTab = "following" | "explore";

const TABS: readonly { key: FeedTab; label: string }[] = [
  { key: "following", label: "Takip Edilenler" },
  { key: "explore", label: "Keşfet" },
];

// Ana sayfanın en üst satırında, TikTok / Reels'teki gibi iki sekme (başlığın
// "Akış | Ara" bağlantılarının yerinde, aynı görünümde: seçili olan kalın ve
// altı çizgili). ARIA sekme deseni: ok tuşlarıyla gezilir, seçili sekme odak alır.
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
      className="pointer-events-auto flex items-center gap-5 @max-[21rem]:gap-3"
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
            className={`relative flex h-11 items-center whitespace-nowrap rounded-sm px-1 text-[17px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white @max-[21rem]:text-[16px] ${
              selected ? "font-semibold text-white" : "font-medium text-white/70 hover:text-white"
            }`}
          >
            {tab.label}
            {selected && (
              <span aria-hidden="true" className="absolute inset-x-1 bottom-1.5 h-[2.5px] rounded-full bg-white" />
            )}
          </button>
        );
      })}
    </div>
  );
}
