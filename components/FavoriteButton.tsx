"use client";

import { useEffect, useState } from "react";
import type { ToggleOutcome } from "../lib/favorites-store";
import { toggleFavorite, useFavorites } from "../lib/use-favorites";

const MESSAGES: Partial<Record<ToggleOutcome, string>> = {
  failed: "Favoriler güncellenemedi. Tekrar dene.",
  missing: "Bu ilan artık yayında değil.",
};

type FavoriteButtonProps = {
  vehicleId: string;
  /**
   * overlay: dikey videonun üstünde, sağdaki buton sütununda (etiketli)
   * sheet: beyaz zeminde (detay çekmecesi)
   * page: açık gri zeminde (ilan sayfası)
   * card: grid kartının fotoğrafının üstünde
   */
  variant: "overlay" | "sheet" | "page" | "card";
  className?: string;
};

const CIRCLE: Record<FavoriteButtonProps["variant"], string> = {
  overlay: "h-11 w-11 bg-black/45",
  sheet: "h-10 w-10 bg-[#F2F3F5] hover:bg-[#E6E8EB]",
  page: "h-11 w-11 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] hover:bg-[#F7F8FA]",
  card: "h-9 w-9 bg-white/90 shadow-[0_1px_4px_rgba(0,0,0,0.25)]",
};

// Hata mesajı butonun yanında kısa süre görünür: video üstünde sola, diğerlerinde alta
const MESSAGE_POSITION: Record<FavoriteButtonProps["variant"], string> = {
  overlay: "right-full top-1 mr-2",
  sheet: "right-0 top-full mt-1.5",
  page: "right-0 top-full mt-1.5",
  card: "right-0 top-full mt-1.5",
};

export default function FavoriteButton({ vehicleId, variant, className = "" }: FavoriteButtonProps) {
  const { ids } = useFavorites();
  const isFavorite = ids.includes(vehicleId);
  const [message, setMessage] = useState<string | null>(null);
  const overlay = variant === "overlay";

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function handleClick() {
    setMessage(null);
    const outcome = await toggleFavorite(vehicleId);
    setMessage(MESSAGES[outcome] ?? null);
  }

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={isFavorite}
        aria-label="Favorilere ekle"
        className={`pointer-events-auto flex flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-2 ${
          overlay
            ? "rounded-lg focus-visible:ring-white"
            : "rounded-full focus-visible:ring-[#003399] focus-visible:ring-offset-2"
        }`}
      >
        <span
          className={`flex items-center justify-center rounded-full motion-safe:transition-transform motion-safe:active:scale-90 ${CIRCLE[variant]}`}
        >
          <HeartIcon
            filled={isFavorite}
            className={`${variant === "card" ? "h-[18px] w-[18px]" : "h-5 w-5"} ${
              isFavorite ? "text-[#E5484D]" : overlay ? "text-white" : "text-[#15181C]"
            }`}
          />
        </span>
        {overlay && (
          <span aria-hidden="true" className="text-[11px] font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            Favori
          </span>
        )}
      </button>
      <p
        role="status"
        aria-live="polite"
        className={`pointer-events-none absolute z-10 w-max max-w-[14rem] text-[12.5px] font-medium ${MESSAGE_POSITION[variant]}`}
      >
        {message && <span className="block rounded-md bg-[#15181C]/90 px-2.5 py-1.5 text-white">{message}</span>}
      </p>
    </div>
  );
}

function HeartIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 20.5s-7.5-4.6-9.2-9.4A5.1 5.1 0 0 1 12 6.6a5.1 5.1 0 0 1 9.2 4.5C19.5 15.9 12 20.5 12 20.5Z" />
    </svg>
  );
}
