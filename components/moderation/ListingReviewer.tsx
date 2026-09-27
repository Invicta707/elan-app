"use client";

import { CircleCheck, RotateCcw, SkipForward, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { REASON_LABELS } from "../../lib/content-moderation";
import {
  formatRelativeTime,
  isSensitiveListing,
  type ListingDecision,
  type PendingListing,
} from "../../lib/moderation";
import { currencySymbol, formatAmount } from "../../lib/search";
import ReviewVideo from "./ReviewVideo";

// /admin/reports → "İncele": ilanlar tek tek, tam ekran. Video uygulamanın içinde
// oynar (TWA'da sekme açılmaz); altta büyük "Reddet" ve "Onayla". Karar verilince
// sıradaki ilan gelir, liste bitince "Karar bekleyen ilan kalmadı". Yerel <dialog>:
// odak içeride kalır; Esc ve Android geri hareketi (dialog cancel) kapatır.
// Liste ve istekler üstteki PendingListingsSection'da; bu bileşen yalnızca çizer.

export type ReviewOutcome = { ok: true; message: string } | { ok: false; message: string };

export default function ListingReviewer({
  items,
  currentId,
  onNavigate,
  onDecide,
  onClose,
}: {
  items: readonly PendingListing[];
  /** null: liste bitti */
  currentId: string | null;
  onNavigate: (vehicleId: string) => void;
  onDecide: (item: PendingListing, action: ListingDecision["action"]) => Promise<ReviewOutcome>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  // Karar bildirimi birkaç saniye sonra kaybolur
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(timer);
  }, [flash]);

  const index = currentId ? items.findIndex((item) => item.vehicle.id === currentId) : -1;
  const item = index >= 0 ? items[index] : null;

  return (
    <dialog
      ref={dialogRef}
      aria-label="İlan incelemesi"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-[#121212] p-0 text-white backdrop:bg-black"
    >
      <div className="mx-auto flex h-full max-w-xl flex-col">
        <header className="flex shrink-0 items-center gap-1 px-2 pb-1 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={onClose}
            aria-label="İncelemeyi kapat"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X aria-hidden="true" className="h-6 w-6" />
          </button>
          <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">
            İçerik denetimi
            {item && (
              <span className="font-medium text-white/60">
                {" "}
                · {index + 1} / {items.length}
              </span>
            )}
          </p>
          {item && items.length > 1 && (
            <button
              type="button"
              onClick={() => onNavigate(items[(index + 1) % items.length].vehicle.id)}
              className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full px-3 text-[14px] font-semibold text-white/85 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Atla
              <SkipForward aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </header>

        <div role="status" aria-live="polite" className="pointer-events-none relative z-10 h-0">
          {flash && (
            <p className="absolute inset-x-3 top-1 flex items-center gap-2 rounded-xl bg-[#1B7A3D] px-3 py-2 text-[14px] font-semibold text-white motion-safe:animate-[fade-in_160ms_ease-out]">
              <CircleCheck aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">{flash}</span>
            </p>
          )}
        </div>

        {item ? (
          <ReviewItem key={item.vehicle.id} item={item} onDecide={onDecide} onDecided={setFlash} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center">
            <CircleCheck aria-hidden="true" className="h-12 w-12 text-[#4ADE80]" />
            <p className="text-[18px] font-semibold">Karar bekleyen ilan kalmadı</p>
            <p className="max-w-xs text-[14px] text-white/70">Yeni ilanlar denetimden geçince burada görünür.</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 h-12 rounded-xl bg-white px-6 text-[15px] font-semibold text-[#121212] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#121212]"
            >
              Panele dön
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}

function ReviewItem({
  item,
  onDecide,
  onDecided,
}: {
  item: PendingListing;
  onDecide: (item: PendingListing, action: ListingDecision["action"]) => Promise<ReviewOutcome>;
  onDecided: (message: string) => void;
}) {
  const [pending, setPending] = useState<ListingDecision["action"] | null>(null);
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [zoomed, setZoomed] = useState<string | null>(null);

  const { vehicle, reasons, needsReview, aiClean, description, sellerUsername } = item;
  const sensitive = isSensitiveListing(item);
  const { photos } = item;
  const canRecheck = !needsReview || reasons.includes("unavailable");

  async function decide(action: ListingDecision["action"]) {
    setConfirmingReject(false);
    setError(null);
    setNotice(null);
    setPending(action);
    const outcome = await onDecide(item, action);
    setPending(null);
    if (!outcome.ok) setError(outcome.message);
    // Onay/ret: üstteki liste ilanı çıkarır, sıradaki gelir; bildirim üstte kalır
    else if (action === "recheck") setNotice(outcome.message);
    else onDecided(outcome.message);
  }

  return (
    <>
      <div className="relative min-h-0 flex-1">
        <ReviewVideo hlsUrl={item.hlsUrl} posterUrl={item.posterUrl} sensitive={sensitive} watchUrl={item.watchUrl} />
        {zoomed && (
          <button
            type="button"
            onClick={() => setZoomed(null)}
            aria-label="Fotoğrafı kapat"
            className="absolute inset-0 z-10 flex items-center justify-center bg-black focus-visible:outline-none"
          >
            <Image src={zoomed} alt="" fill unoptimized sizes="100vw" className="object-contain" />
          </button>
        )}
      </div>

      <section aria-label="İlan bilgileri" className="max-h-[32dvh] shrink-0 overflow-y-auto overscroll-contain px-4 pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="min-w-0 truncate text-[18px] font-semibold leading-tight">
            {vehicle.title} · {vehicle.year}
          </h2>
          <p className="shrink-0 text-[16px] font-bold tabular-nums">
            {currencySymbol(vehicle.currency)}
            {formatAmount(vehicle.price)}
          </p>
        </div>
        <p className="mt-0.5 truncate text-[13px] text-white/65">
          {[vehicle.city, sellerUsername ? `@${sellerUsername}` : null, formatRelativeTime(vehicle.createdAt)]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Denetim nedenleri">
          {aiClean ? (
            <span className="rounded-full bg-[#1B7A3D]/25 px-2 py-0.5 text-[12px] font-semibold text-[#86EFAC]">
              Otomatik tarama temiz · videoyu izleyip onayla
            </span>
          ) : needsReview ? (
            reasons.map((reason) => (
              <span key={reason} className="rounded-full bg-[#8A6116]/35 px-2 py-0.5 text-[12px] font-semibold text-[#FCD34D]">
                {REASON_LABELS[reason]}
              </span>
            ))
          ) : (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[12px] font-semibold text-white/75">
              Otomatik denetim sürüyor ya da yarıda kaldı
            </span>
          )}
        </div>

        {description && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-2 block w-full rounded-lg bg-white/[0.06] px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {/* line-clamp kendi display değerini kullanır; "block" ile birlikte verilirse kısaltmaz */}
            <span className={`whitespace-pre-wrap break-words text-[14px] text-white/85 ${expanded ? "block" : "line-clamp-2"}`}>
              {description}
            </span>
          </button>
        )}

        {(photos.length > 0 || canRecheck) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            {photos.length > 0 && (
              <button
                type="button"
                onClick={() => setShowPhotos((v) => !v)}
                aria-pressed={showPhotos}
                className="min-h-9 rounded-sm text-[13.5px] font-semibold text-white/85 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {showPhotos ? "Fotoğrafları gizle" : `Fotoğraflar (${photos.length})`}
              </button>
            )}
            {canRecheck && (
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void decide("recheck")}
                className="inline-flex min-h-9 items-center gap-1 rounded-sm text-[13.5px] font-semibold text-white/85 underline-offset-2 hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                {pending === "recheck" ? "Denetleniyor…" : "Tekrar denetle"}
              </button>
            )}
          </div>
        )}
        {showPhotos && (
          <ul className="mt-1 flex gap-1.5 overflow-x-auto pb-1" aria-label="Fotoğraflar">
            {photos.map((url, i) => (
              <li key={url} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setZoomed(url)}
                  aria-label={`Fotoğraf ${i + 1}, büyüt`}
                  className="relative block h-16 w-16 overflow-hidden rounded-lg bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <Image src={url} alt="" fill unoptimized sizes="64px" className="object-cover" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div role="status" aria-live="polite">
          {error && <p className="mt-2 rounded-lg bg-[#B42318]/25 px-3 py-2 text-[13.5px] text-[#FECACA]">{error}</p>}
          {notice && <p className="mt-2 rounded-lg bg-white/10 px-3 py-2 text-[13.5px] text-white/85">{notice}</p>}
        </div>
      </section>

      <footer className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {confirmingReject ? (
          <div className="rounded-xl bg-[#2A1215] p-3">
            <p className="text-[14px] leading-snug text-white/90">
              Reddedilsin mi? Video ve fotoğraflar kalıcı olarak silinir; satıcı &quot;yayınlanmadı&quot; uyarısını görür.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setConfirmingReject(false)}
                className="h-12 rounded-xl bg-white/10 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => void decide("reject")}
                className="h-12 rounded-xl bg-[#C4282E] text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Evet, reddet
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={pending !== null}
              aria-busy={pending === "reject"}
              onClick={() => setConfirmingReject(true)}
              className="h-14 rounded-xl border border-[#F87171]/70 text-[16px] font-semibold text-[#FCA5A5] transition-transform active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {pending === "reject" ? "Reddediliyor…" : "Reddet"}
            </button>
            <button
              type="button"
              disabled={pending !== null}
              aria-busy={pending === "approve"}
              onClick={() => void decide("approve")}
              className="h-14 rounded-xl bg-[#003399] text-[16px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {pending === "approve" ? "Yayına alınıyor…" : "Onayla"}
            </button>
          </div>
        )}
      </footer>
    </>
  );
}
