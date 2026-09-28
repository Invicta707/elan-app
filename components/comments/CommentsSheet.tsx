"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { bodyFont, displayFont } from "../../app/fonts";
import { CommentComposerArea, CommentList, CommentListError, CommentThreadDialogs } from "./CommentThreadView";
import { useCommentThread } from "./useCommentThread";

export { CommentComposer, CommentRow } from "./CommentThreadView";

// Akışta video altı yorumlar (mobil ve 1024 px'ten dar ekran): alttan açılan
// pencere (ekranın en fazla ~%70'i). Video arkada hafif kararmış halde oynamaya
// devam eder. Yerel <dialog>: odak içeride kalır; Esc, Android geri hareketi,
// dışarı dokunma ve tutamaçtan aşağı kaydırma kapatır. document.body'ye çizilir:
// akış katmanının pointer-events-none alanından etkilenmez. Mobil klavye açılınca
// pencere görünür alana (visualViewport) oturur, yazma alanı klavyenin üstünde kalır.
// Davranış: useCommentThread (masaüstü yan panelle ortak). Kurallar ve istekler:
// lib/comments.ts, /api/vehicles/[id]/comments.

/** Kapatmak için tutamaçtan aşağı sürükleme mesafesi (px) */
const DRAG_CLOSE_DISTANCE = 110;

/** Klavye yüksekliği ve görünür alan (klavye yokken inset 0) */
function useKeyboardInset() {
  const [state, setState] = useState<{ inset: number; height: number } | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      setState({ inset, height: viewport.height });
    };
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return state;
}

export default function CommentsSheet({
  vehicleId,
  initialTotal,
  onTotalChange,
  onClose,
}: {
  vehicleId: string;
  initialTotal: number;
  /** Akış kartındaki sayaç anında güncellensin */
  onTotalChange?: (total: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const drag = useRef<{ startY: number; dy: number } | null>(null);

  const thread = useCommentThread({ vehicleId, initialTotal, onTotalChange });
  const keyboard = useKeyboardInset();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  // Tutamaçtan aşağı sürükleyince kapanır
  function onDragStart(event: ReactPointerEvent<HTMLDivElement>) {
    drag.current = { startY: event.clientY, dy: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onDragMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current || !sheetRef.current) return;
    drag.current.dy = Math.max(0, event.clientY - drag.current.startY);
    sheetRef.current.style.transform = `translateY(${drag.current.dy}px)`;
    sheetRef.current.style.transition = "none";
  }
  function onDragEnd() {
    const moved = drag.current?.dy ?? 0;
    drag.current = null;
    if (!sheetRef.current) return;
    sheetRef.current.style.transition = "transform 180ms ease-out";
    if (moved > DRAG_CLOSE_DISTANCE) {
      onClose();
      return;
    }
    sheetRef.current.style.transform = "";
  }

  const keyboardOpen = Boolean(keyboard && keyboard.inset > 0);
  const { total } = thread;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby="comments-title"
      onCancel={(event) => {
        // İçteki pencerenin (giriş, kullanıcı adı, şikayet) kapanışı React ağacında
        // buraya da iletilir; yalnızca bu pencerenin kendi Esc / geri hareketi kapatır
        if (event.target !== dialogRef.current) return;
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      style={{ bottom: keyboard?.inset ?? 0 }}
      className={`${displayFont.variable} ${bodyFont.variable} fixed inset-x-0 top-auto m-0 w-full max-w-none bg-transparent p-0 [font-family:var(--font-body)] backdrop:bg-black/35`}
    >
      <div
        ref={sheetRef}
        style={{ height: keyboardOpen && keyboard ? `${Math.max(240, keyboard.height - 12)}px` : undefined }}
        className="mx-auto flex h-[min(70dvh,640px)] w-full max-w-lg flex-col rounded-t-3xl bg-white text-[#15181C] shadow-[0_-8px_32px_rgba(0,0,0,0.18)] motion-safe:animate-[sheet-up_240ms_cubic-bezier(0.22,1,0.36,1)]"
      >
        {/* Tutamaç + başlık: aşağı sürükleyince kapanır */}
        <div
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          className="relative shrink-0 cursor-grab touch-none select-none border-b border-[#EEF0F3] pb-2"
        >
          <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[#D5D9DF]" />
          <h2 id="comments-title" className="mt-2 text-center text-[15px] font-semibold">
            {total > 0 ? `${total.toLocaleString("tr-TR")} yorum` : "Yorumlar"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            onPointerDown={(event) => event.stopPropagation()}
            aria-label="Yorumları kapat"
            className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full text-[#5B616B] hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <CommentList
          thread={thread}
          tone="light"
          listRef={listRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4"
        />

        <CommentListError thread={thread} tone="light" />

        <CommentComposerArea
          thread={thread}
          tone="light"
          keyboardOpen={keyboardOpen}
          onSent={() => listRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
        />
      </div>

      <CommentThreadDialogs thread={thread} />
    </dialog>,
    document.body,
  );
}
