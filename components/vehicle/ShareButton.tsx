"use client";

import { useEffect, useState } from "react";
import { shareListing, shareMessage, vehiclePath, type ShareEnvironment } from "../../lib/share";

type Message = { text: string; whatsappUrl: string | null };

function browserShareEnvironment(): ShareEnvironment {
  return {
    nav: navigator,
    // Fare/touchpad: Windows/macOS'un paylaşım penceresi yerine kopyala + WhatsApp Web
    isDesktop: window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    openWindow: (url) => {
      // "noopener" özelliği verilirse window.open her zaman null döner ve
      // engellenip engellenmediği anlaşılamaz; bağlantı sonradan koparılır
      const opened = window.open(url, "_blank");
      if (opened) opened.opener = null;
      return opened !== null;
    },
  };
}

export default function ShareButton({
  vehicleId,
  path,
  label = "İlanı paylaş",
  title,
  text,
  variant = "pill",
  className = "",
}: {
  vehicleId?: string;
  /** İlan dışında bir sayfa paylaşılıyorsa (ör. profil: /@kullanici_adi) */
  path?: string;
  /** Düğmenin erişilebilir adı */
  label?: string;
  title: string;
  text: string;
  /**
   * pill: beyaz zeminde metinli buton (ilan sayfası, detay çekmecesi)
   * overlay: dikey videonun üstünde, sağdaki buton sütununda (etiketli)
   * icon: yuvarlak, yalnızca simge (ilan sayfasının alt çubuğu: yanında iki iletişim butonu)
   */
  variant?: "pill" | "overlay" | "icon";
  className?: string;
}) {
  const [message, setMessage] = useState<Message | null>(null);
  const overlay = variant === "overlay";

  useEffect(() => {
    if (!message) return;
    // WhatsApp bağlantısı içeren mesaj dokunulabilsin diye daha uzun kalır
    const timer = window.setTimeout(() => setMessage(null), message.whatsappUrl ? 6000 : 3000);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function handleShare() {
    const url = new URL(path ?? (vehicleId ? vehiclePath(vehicleId) : "/"), window.location.origin).toString();
    const outcome = await shareListing({ url, title, text }, browserShareEnvironment());
    const shown = shareMessage(outcome);
    setMessage(
      shown && outcome.kind === "fallback"
        ? { text: shown.text, whatsappUrl: shown.showWhatsappLink ? outcome.whatsappUrl : null }
        : null,
    );
  }

  return (
    <div className={`relative ${className}`}>
      {overlay ? (
        <button
          type="button"
          onClick={handleShare}
          aria-label={label}
          className="pointer-events-auto flex flex-col items-center gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45">
            <ShareIcon className="h-5 w-5" />
          </span>
          <span aria-hidden="true" className="text-[11px] font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            Paylaş
          </span>
        </button>
      ) : variant === "icon" ? (
        <button
          type="button"
          onClick={handleShare}
          aria-label={label}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-[#C9CED6] bg-white text-[#15181C] transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
        >
          <ShareIcon className="h-5 w-5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={handleShare}
          className="flex h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-full border border-[#C9CED6] bg-white px-3 text-[15px] font-semibold text-[#15181C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
        >
          <ShareIcon className="h-5 w-5 shrink-0" />
          İlanı paylaş
        </button>
      )}

      <div
        role="status"
        aria-live="polite"
        className={
          overlay
            ? "absolute right-full top-1 z-10 mr-2 w-max max-w-[13rem]"
            : "absolute inset-x-0 bottom-full mb-2 flex justify-center"
        }
      >
        {message && (
          <p
            className={`pointer-events-auto rounded-md px-2.5 py-1.5 text-[12.5px] font-medium leading-snug ${
              overlay ? "bg-[#15181C]/90 text-white" : "bg-[#15181C] text-white shadow-md"
            }`}
          >
            {message.text}
            {message.whatsappUrl && (
              <>
                {" "}
                <a
                  href={message.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-[#6EE7A0] underline underline-offset-2"
                >
                  WhatsApp&apos;ta paylaş
                </a>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}
