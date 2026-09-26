"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { bodyFont, displayFont } from "../../app/fonts";

// Alttan açılan menü (mobil) / ortada kart (masaüstü). Yerel <dialog>:
// odak içeride kalır, Esc kapatır. document.body'ye çizilir: üst çubuğun
// pointer-events-none alanından etkilenmez.

export type SheetAction = {
  label: string;
  description?: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  onSelect: () => void;
};

export default function BottomSheet({
  title,
  onClose,
  actions,
  children,
  closeLabel = "Vazgeç",
}: {
  title: string;
  onClose: () => void;
  actions?: SheetAction[];
  children?: ReactNode;
  /** Alttaki kapatma düğmesinin metni (ör. "Daha sonra") */
  closeLabel?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className={`${displayFont.variable} ${bodyFont.variable} fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none bg-transparent p-0 [font-family:var(--font-body)] backdrop:bg-black/45 backdrop:backdrop-blur-[2px] sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-[420px] sm:-translate-x-1/2 sm:-translate-y-1/2`}
    >
      <div className="rounded-t-3xl bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] text-[#15181C] shadow-[0_-8px_32px_rgba(0,0,0,0.18)] motion-safe:animate-[sheet-up_240ms_cubic-bezier(0.22,1,0.36,1)] sm:rounded-3xl">
        <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[#D5D9DF] sm:hidden" />
        <h2 id={titleId} className="px-5 pt-3 pb-2 text-center text-[15px] font-semibold text-[#5B616B]">
          {title}
        </h2>
        {children}
        {actions && (
          <ul className="px-2">
            {actions.map((action) => (
              <li key={action.label}>
                <button
                  type="button"
                  onClick={action.onSelect}
                  className={`flex min-h-14 w-full items-center gap-3.5 rounded-2xl px-3.5 py-2.5 text-left transition-colors hover:bg-[#F2F3F5] active:bg-[#EAECEF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] ${
                    action.tone === "danger" ? "text-[#D92D20]" : "text-[#15181C]"
                  }`}
                >
                  {action.icon && <span className="flex h-6 w-6 shrink-0 items-center justify-center">{action.icon}</span>}
                  <span className="min-w-0">
                    <span className="block text-[16px] font-semibold">{action.label}</span>
                    {action.description && (
                      <span className="block text-[13px] leading-snug text-[#5B616B]">{action.description}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="px-4 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-12 w-full rounded-2xl bg-[#F2F3F5] text-[16px] font-semibold text-[#15181C] transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
