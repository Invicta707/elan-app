"use client";

import { MessageCircle } from "lucide-react";
import { useState } from "react";
import { DESKTOP_MEDIA_QUERY } from "../../lib/feed-navigation";
import { formatCount } from "../../lib/showcase";
import { useFeedPanel } from "../feed/FeedPanelContext";
import CommentsSheet from "./CommentsSheet";

// Akışın sağ sütununda Favori ile Paylaş arasında: yorum simgesi ve sayısı.
// Mobilde dokununca yorum penceresi alttan açılır; video arkada oynamaya devam
// eder. Masaüstünde (1024 px ve üstü) yorumlar sağdaki kalıcı panelde:
// düğme oraya kaydırır ve yazma alanına odaklanır.
export default function CommentButton({
  vehicleId,
  count,
  onCountChange,
}: {
  vehicleId: string;
  count: number;
  onCountChange: (count: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const panel = useFeedPanel();

  function handleClick() {
    if (panel && window.matchMedia(DESKTOP_MEDIA_QUERY).matches) {
      panel.focusComments(vehicleId);
      return;
    }
    setOpen(true);
  }

  return (
    <>
      <CommentButtonView count={count} onClick={handleClick} />
      {open && (
        <CommentsSheet vehicleId={vehicleId} initialTotal={count} onTotalChange={onCountChange} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/** Görünüm (test edilebilir) */
export function CommentButtonView({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={count > 0 ? `Yorumlar (${count})` : "Yorumlar"}
      className="group pointer-events-auto flex flex-col items-center gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 transition-colors lg:bg-[#27272A] lg:group-hover:bg-[#3F3F46]">
        <MessageCircle aria-hidden="true" className="h-5 w-5" strokeWidth={2.2} />
      </span>
      <span aria-hidden="true" className="text-[11px] font-semibold tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
        {count > 0 ? formatCount(count) : "Yorum"}
      </span>
    </button>
  );
}
