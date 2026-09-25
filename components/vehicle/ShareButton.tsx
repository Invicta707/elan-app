"use client";

import { useEffect, useState } from "react";
import { shareOrCopy, vehiclePath, type ShareOutcome } from "../../lib/share";

const MESSAGES: Partial<Record<ShareOutcome, string>> = {
  copied: "Bağlantı kopyalandı.",
  failed: "Paylaşılamadı. Adres çubuğundaki bağlantıyı kopyalayabilirsin.",
};

export default function ShareButton({
  vehicleId,
  title,
  text,
  className = "",
}: {
  vehicleId: string;
  title: string;
  text: string;
  className?: string;
}) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function handleShare() {
    const url = new URL(vehiclePath(vehicleId), window.location.origin).toString();
    const outcome = await shareOrCopy({ url, title, text }, navigator);
    setMessage(MESSAGES[outcome] ?? null);
  }

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={handleShare}
        className="flex h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-full border border-[#C9CED6] bg-white px-3 text-[15px] font-semibold text-[#15181C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
      >
        <ShareIcon className="h-5 w-5 shrink-0" />
        İlanı paylaş
      </button>
      <p role="status" aria-live="polite" className="absolute inset-x-0 -top-7 text-center text-[13px] font-medium text-[#1B7A3D]">
        {message}
      </p>
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
