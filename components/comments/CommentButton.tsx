"use client";

import { MessageCircle } from "lucide-react";
import { useState } from "react";
import { DESKTOP_MEDIA_QUERY } from "../../lib/feed-navigation";
import { formatCount } from "../../lib/showcase";
import { ACTION_BUTTON, ACTION_ICON, ACTION_ICON_BOX, ACTION_LABEL } from "../feed/actionStyles";
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
      className={ACTION_BUTTON}
    >
      <span className={ACTION_ICON_BOX}>
        <MessageCircle aria-hidden="true" className={ACTION_ICON} strokeWidth={2.2} />
      </span>
      <span aria-hidden="true" className={`tabular-nums ${ACTION_LABEL}`}>
        {count > 0 ? formatCount(count) : "Yorum"}
      </span>
    </button>
  );
}
