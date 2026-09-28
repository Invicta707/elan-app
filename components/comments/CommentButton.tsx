"use client";

import { MessageCircle } from "lucide-react";
import { useState } from "react";
import { formatCount } from "../../lib/showcase";
import { ACTION_BUTTON, ACTION_ICON, ACTION_ICON_BOX, ACTION_LABEL } from "../feed/actionStyles";
import CommentsSheet from "./CommentsSheet";

// Akışın sağ sütununda Favori ile Paylaş arasında: yorum simgesi ve sayısı.
// Dokununca yorum penceresi alttan açılır; video arkada oynamaya devam eder.
// (Masaüstünde yorumlar vitrin penceresinin sağ panelinde.)
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

  return (
    <>
      <CommentButtonView count={count} onClick={() => setOpen(true)} />
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
