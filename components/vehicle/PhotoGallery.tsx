"use client";

import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type PhotoGalleryProps = {
  photos: string[];
  title: string;
  /**
   * Tam ekran görüntüleyicinin çizileceği yer. Detay çekmecesinde modal
   * <dialog>'un kendisi (dışındaki her şey inert, kaydırılan panel içinde
   * fixed konum bozulur), sayfada document.body.
   */
  lightboxContainer: Element | null;
  onLightboxChange?: (open: boolean) => void;
  /** Sayfanın en üstündeki galeride ilk fotoğraf (LCP) beklemeden yüklenir */
  eagerFirst?: boolean;
};

// Yatay kaydırılan fotoğraf şeridi; dokunulan fotoğraf tam ekran açılır.
export default function PhotoGallery({
  photos,
  title,
  lightboxContainer,
  onLightboxChange,
  eagerFirst = false,
}: PhotoGalleryProps) {
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const restoreFocusRef = useRef<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Odak, görüntüleyici kapandıktan (commit sonrası, panelin inert'i kalkınca)
  // açan küçük resme döner
  useEffect(() => {
    if (lightboxIndex !== null || restoreFocusRef.current === null) return;
    thumbRefs.current[restoreFocusRef.current]?.focus();
    restoreFocusRef.current = null;
  }, [lightboxIndex]);

  function open(index: number) {
    setLightboxIndex(index);
    onLightboxChange?.(true);
  }

  function close() {
    restoreFocusRef.current = lightboxIndex;
    setLightboxIndex(null);
    onLightboxChange?.(false);
  }

  if (photos.length === 0) return null;

  return (
    <section aria-label="Fotoğraflar">
      <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {photos.map((url, index) => (
          <li key={url} className="w-[78%] shrink-0 snap-start sm:w-[62%]">
            <button
              ref={(el) => {
                thumbRefs.current[index] = el;
              }}
              type="button"
              onClick={() => open(index)}
              aria-label={`Fotoğraf ${index + 1} / ${photos.length}, tam ekran aç`}
              className="relative block aspect-[4/3] w-full overflow-hidden rounded-lg bg-[#E6E8EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
            >
              <PhotoImage
                src={url}
                sizes="(min-width: 640px) 320px, 78vw"
                className="object-cover"
                eager={eagerFirst && index === 0}
              />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[12px] text-[#5B616B]">{photos.length} fotoğraf · büyütmek için dokun</p>

      {lightboxIndex !== null &&
        lightboxContainer &&
        createPortal(
          <Lightbox photos={photos} startIndex={lightboxIndex} title={title} onClose={close} />,
          lightboxContainer,
        )}
    </section>
  );
}

export function GallerySkeleton() {
  return (
    <div aria-hidden="true" className="-mx-4 flex gap-2 overflow-hidden px-4">
      <div className="aspect-[4/3] w-[78%] shrink-0 animate-pulse rounded-lg bg-[#E6E8EB] motion-reduce:animate-none" />
      <div className="aspect-[4/3] w-[78%] shrink-0 animate-pulse rounded-lg bg-[#E6E8EB] motion-reduce:animate-none" />
    </div>
  );
}

function Lightbox({
  photos,
  startIndex,
  title,
  onClose,
}: {
  photos: string[];
  startIndex: number;
  title: string;
  onClose: () => void;
}) {
  const scrollerRef = useRef<HTMLUListElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [index, setIndex] = useState(startIndex);

  // İlk boyamadan önce dokunulan fotoğrafa konumlan (atlama görünmesin)
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollLeft = startIndex * scroller.clientWidth;
    closeRef.current?.focus();
  }, [startIndex]);

  function goTo(next: number) {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const target = Math.max(0, Math.min(photos.length - 1, next));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ left: target * scroller.clientWidth, behavior: reduceMotion ? "auto" : "smooth" });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} fotoğrafları`}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") goTo(index + 1);
        else if (event.key === "ArrowLeft") goTo(index - 1);
        else if (event.key === "Escape") {
          // Çevreleyen çekmecenin de kapanmasını (dialog "cancel") önler
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      className="fixed inset-0 z-50 bg-black text-white"
    >
      <ul
        ref={scrollerRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="flex h-full snap-x snap-mandatory overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {photos.map((url, i) => (
          <li
            key={url}
            aria-label={`Fotoğraf ${i + 1} / ${photos.length}`}
            className="relative h-full w-full shrink-0 snap-center"
          >
            <PhotoImage src={url} sizes="100vw" className="object-contain" />
          </li>
        ))}
      </ul>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-[linear-gradient(to_bottom,rgba(0,0,0,0.6),rgba(0,0,0,0))] px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-6">
        <p aria-live="polite" className="px-2 text-[15px] font-semibold tabular-nums">
          {index + 1} / {photos.length}
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Tam ekranı kapat"
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>

      {photos.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            aria-label="Önceki fotoğraf"
            className="absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 disabled:opacity-30 sm:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ChevronIcon className="h-5 w-5 rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            disabled={index === photos.length - 1}
            aria-label="Sonraki fotoğraf"
            className="absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 disabled:opacity-30 sm:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ChevronIcon className="h-5 w-5" />
          </button>
        </>
      )}
    </div>
  );
}

// Yüklenemeyen fotoğrafta kırık görsel yerine sade bir yer tutucu
function PhotoImage({
  src,
  sizes,
  className,
  eager = false,
}: {
  src: string;
  sizes: string;
  className: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="absolute inset-0 flex items-center justify-center text-[13px] text-[#8A9099]">
        Fotoğraf yüklenemedi
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt=""
      fill
      sizes={sizes}
      loading={eager ? "eager" : undefined}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps} className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps} className={className} aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
