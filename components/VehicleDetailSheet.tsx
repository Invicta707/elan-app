"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { bodyFont, displayFont } from "../app/fonts";
import { fetchVehicleDetails, type FeedVehicle, type VehicleDetails } from "../lib/feed";
import { currencySymbol, formatAmount } from "../lib/search";
import { BODY_TYPE_LABELS, FUEL_LABELS, TRANSMISSION_LABELS } from "../lib/vehicle-labels";

type VehicleDetailSheetProps = {
  vehicle: FeedVehicle;
  onClose: () => void;
  onContact: () => void;
  isContacting: boolean;
  /** VideoCard'daki iletişim hatası; çekmece açıkken kartın kendi mesajı arkada kalır */
  notice: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; details: VehicleDetails };

const TRANSITION_MS = 280;
// Bu kadar aşağı sürüklenirse ya da hızlı bir fiskeyle bırakılırsa çekmece kapanır
const CLOSE_DRAG_PX = 120;
const CLOSE_VELOCITY_PX_PER_MS = 0.5;
// Parmak bu kadar hareket etmeden yön (dikey sürükleme / yatay galeri) belirlenmez
const DIRECTION_SLOP_PX = 6;

// Akışın kaydırma alanının dışına (body'ye) taşınır: çekmecedeki kaydırmalar ve
// dokunuşlar dikey snap-scroll akışına zincirlenmez.
export default function VehicleDetailSheet(props: VehicleDetailSheetProps) {
  return createPortal(<Sheet {...props} />, document.body);
}

function Sheet({ vehicle, onClose, onContact, isContacting, notice }: VehicleDetailSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const restoreFocusRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const titleId = useId();

  const [isShown, setShown] = useState(false);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Açılış: modal olarak göster, ilk kare aşağıda çizildikten sonra yukarı kaydır
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();

    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetchVehicleDetails(vehicle.id)
      .then((details) => {
        if (active) setLoad({ status: "ready", details });
      })
      .catch((error) => {
        console.error("İlan detayları yüklenemedi:", error);
        if (active) setLoad({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [vehicle.id, reloadKey]);

  // Her render'da değişen onClose, kaydırma dinleyicilerini yeniden kurdurmasın diye ref'te
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setShown(false);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(
      () => {
        dialogRef.current?.close();
        // "close" olayı sekme arka plandayken ertelenebilir; çekmecenin kalkması
        // ve videonun sürmesi ona bağlı kalmasın. (onClose tekrar çağrılırsa zararsız.)
        onCloseRef.current();
      },
      reduceMotion ? 0 : TRANSITION_MS,
    );
  }, []);

  // Aşağı sürükleyerek kapatma. React'in touchmove'u pasif olduğu için
  // preventDefault çağrılabilen yerel dinleyiciler kullanılıyor.
  useEffect(() => {
    const panel = panelRef.current;
    const header = headerRef.current;
    const body = bodyRef.current;
    const backdrop = backdropRef.current;
    if (!panel || !header || !body || !backdrop) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let fromHeader = false;
    let decided = false;
    let dragging = false;
    let offset = 0;

    function applyOffset(px: number) {
      offset = px;
      panel!.style.translate = `0 ${px}px`;
      backdrop!.style.opacity = String(Math.max(0, 1 - px / panel!.offsetHeight));
    }

    function onStart(event: TouchEvent) {
      if (event.touches.length !== 1) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      startTime = event.timeStamp;
      fromHeader = header!.contains(event.target as Node);
      decided = false;
      dragging = false;
    }

    function onMove(event: TouchEvent) {
      if (event.touches.length !== 1) return;
      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;

      if (!dragging) {
        if (decided) return;
        if (Math.abs(dx) < DIRECTION_SLOP_PX && Math.abs(dy) < DIRECTION_SLOP_PX) return;
        decided = true;
        // Yalnızca aşağı yönlü ve (tutamaçtan başlayan ya da içerik en üstteyken
        // yapılan) hareket çekmeceyi sürükler; yatay galeri kaydırması ve içerik
        // kaydırması tarayıcıya bırakılır.
        const isDownward = dy > 0 && dy > Math.abs(dx);
        if (!isDownward || !(fromHeader || body!.scrollTop <= 0)) return;
        dragging = true;
        panel!.style.transition = "none";
        backdrop!.style.transition = "none";
      }

      event.preventDefault();
      applyOffset(Math.max(0, dy));
    }

    function onEnd(event: TouchEvent) {
      if (!dragging) return;
      dragging = false;
      const velocity = offset / Math.max(1, event.timeStamp - startTime);
      const shouldClose = offset > CLOSE_DRAG_PX || velocity > CLOSE_VELOCITY_PX_PER_MS;

      // Satır içi değerler temizlenince sınıftaki konum geçişle devralır:
      // kapanıyorsa aşağıya, kapanmıyorsa yerine döner.
      panel!.style.transition = "";
      panel!.style.translate = "";
      backdrop!.style.transition = "";
      backdrop!.style.opacity = "";
      offset = 0;
      if (shouldClose) requestClose();
    }

    panel.addEventListener("touchstart", onStart, { passive: true });
    panel.addEventListener("touchmove", onMove, { passive: false });
    panel.addEventListener("touchend", onEnd);
    panel.addEventListener("touchcancel", onEnd);
    return () => {
      panel.removeEventListener("touchstart", onStart);
      panel.removeEventListener("touchmove", onMove);
      panel.removeEventListener("touchend", onEnd);
      panel.removeEventListener("touchcancel", onEnd);
    };
  }, [requestClose]);

  // Odak, panelin inert'i kalktıktan (commit sonrası) sonra açan küçük resme döner
  useEffect(() => {
    if (lightboxIndex !== null || restoreFocusRef.current === null) return;
    thumbRefs.current[restoreFocusRef.current]?.focus();
    restoreFocusRef.current = null;
  }, [lightboxIndex]);

  function closeLightbox() {
    restoreFocusRef.current = lightboxIndex;
    setLightboxIndex(null);
  }

  function retry() {
    setLoad({ status: "loading" });
    setReloadKey((key) => key + 1);
  }

  const details = load.status === "ready" ? load.details : null;
  const photos = details?.photoUrls ?? [];
  const title = `${vehicle.brandName} ${vehicle.modelName}`;
  const price = `${currencySymbol(vehicle.currency)}${formatAmount(vehicle.price)}`;

  const bodyTypeValue =
    load.status === "loading"
      ? "…"
      : details?.bodyType
        ? (BODY_TYPE_LABELS[details.bodyType] ?? "—")
        : "—";

  const rows: { label: string; value: ReactNode }[] = [
    { label: "Marka", value: vehicle.brandName },
    { label: "Model", value: vehicle.modelName },
    { label: "Yıl", value: vehicle.year },
    { label: "Kilometre", value: `${formatAmount(vehicle.mileageKm)} km` },
    { label: "Fiyat", value: price },
    { label: "Yakıt türü", value: FUEL_LABELS[vehicle.fuelType] ?? vehicle.fuelType },
    { label: "Vites", value: TRANSMISSION_LABELS[vehicle.transmission] ?? vehicle.transmission },
    { label: "Kasa tipi", value: bodyTypeValue },
    { label: "Şehir", value: vehicle.city ?? "—" },
    {
      label: "Hasar durumu",
      value: vehicle.hasHeavyDamage ? (
        <span className="text-[#C4282E]">Ağır Hasarlı</span>
      ) : (
        "Hasarsız / Hafif"
      ),
    },
  ];

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        // Esc: önce tam ekran fotoğraf kapanır, sonra çekmece (animasyonla)
        event.preventDefault();
        if (lightboxIndex !== null) closeLightbox();
        else requestClose();
      }}
      className={`${displayFont.variable} ${bodyFont.variable} fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden border-0 bg-transparent p-0 text-[#15181C] [font-family:var(--font-body)] backdrop:bg-transparent`}
    >
      <div
        ref={backdropRef}
        aria-hidden="true"
        onClick={requestClose}
        className={`absolute inset-0 touch-none bg-black/55 transition-opacity duration-[280ms] motion-reduce:transition-none ${
          isShown ? "opacity-100" : "opacity-0"
        }`}
      />

      <div
        ref={panelRef}
        inert={lightboxIndex !== null}
        className={`absolute inset-x-0 bottom-0 mx-auto flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-[0_-8px_32px_rgba(0,0,0,0.25)] transition-[translate] duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${
          isShown ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div ref={headerRef} className="shrink-0 touch-none px-4 pt-2.5 pb-3">
          <div aria-hidden="true" className="mx-auto h-1.5 w-10 rounded-full bg-[#CDD2D9]" />
          <div className="mt-2.5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="truncate text-[24px] font-semibold leading-tight [font-family:var(--font-display)]"
              >
                {title}
              </h2>
              <p className="mt-0.5 text-[17px] font-extrabold tabular-nums [font-family:var(--font-display)]">
                {price}
              </p>
            </div>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Detayları kapat"
              className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F2F3F5] hover:bg-[#E6E8EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div
          ref={bodyRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5"
        >
          {load.status === "loading" && (
            <div aria-hidden="true" className="-mx-4 mb-5 flex gap-2 overflow-hidden px-4">
              <div className="aspect-[4/3] w-[78%] shrink-0 animate-pulse rounded-lg bg-[#E6E8EB] motion-reduce:animate-none" />
              <div className="aspect-[4/3] w-[78%] shrink-0 animate-pulse rounded-lg bg-[#E6E8EB] motion-reduce:animate-none" />
            </div>
          )}

          {load.status === "error" && (
            <div
              role="status"
              className="mb-5 flex items-center justify-between gap-3 rounded-lg bg-[#FDEDEC] px-3 py-2.5 text-[14px] text-[#B42318]"
            >
              <span>Fotoğraflar ve açıklama yüklenemedi.</span>
              <button
                type="button"
                onClick={retry}
                className="shrink-0 rounded-md px-2 py-1 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B42318]"
              >
                Tekrar dene
              </button>
            </div>
          )}

          {photos.length > 0 && (
            <section aria-label="Fotoğraflar" className="mb-5">
              <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {photos.map((url, index) => (
                  <li key={url} className="w-[78%] shrink-0 snap-start sm:w-[62%]">
                    <button
                      ref={(el) => {
                        thumbRefs.current[index] = el;
                      }}
                      type="button"
                      onClick={() => setLightboxIndex(index)}
                      aria-label={`Fotoğraf ${index + 1} / ${photos.length}, tam ekran aç`}
                      className="relative block aspect-[4/3] w-full overflow-hidden rounded-lg bg-[#E6E8EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
                    >
                      <PhotoImage
                        src={url}
                        sizes="(min-width: 640px) 320px, 78vw"
                        className="object-cover"
                      />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[12px] text-[#5B616B]">
                {photos.length} fotoğraf · büyütmek için dokun
              </p>
            </section>
          )}

          <section aria-labelledby={`${titleId}-specs`}>
            <h3 id={`${titleId}-specs`} className="mb-2 text-[15px] font-semibold">
              Araç bilgileri
            </h3>
            <dl className="divide-y divide-[#E9ECEF] rounded-lg border border-[#E3E6EA]">
              {rows.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4 px-3 py-2.5">
                  <dt className="text-[14px] text-[#5B616B]">{row.label}</dt>
                  <dd className="text-right text-[15px] font-semibold">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {details?.description && (
            <section aria-labelledby={`${titleId}-desc`} className="mt-5">
              <h3 id={`${titleId}-desc`} className="mb-2 text-[15px] font-semibold">
                Satıcının açıklaması
              </h3>
              <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-[#2A2F36]">
                {details.description}
              </p>
            </section>
          )}
        </div>

        <div className="shrink-0 border-t border-[#E3E6EA] bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div role="status" aria-live="polite">
            {notice && <p className="mb-2 text-center text-[13px] text-[#B42318]">{notice}</p>}
          </div>
          <button
            type="button"
            onClick={onContact}
            disabled={isContacting}
            aria-busy={isContacting}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#25D366] text-base font-semibold text-[#062612] disabled:opacity-70 motion-safe:transition-transform motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15181C] focus-visible:ring-offset-2"
          >
            <ChatIcon className="h-5 w-5" />
            {isContacting ? "Açılıyor…" : "WhatsApp'tan yaz"}
          </button>
        </div>
      </div>

      {lightboxIndex !== null && (
        <Lightbox photos={photos} startIndex={lightboxIndex} title={title} onClose={closeLightbox} />
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------
// Tam ekran fotoğraf görüntüleyici
// ---------------------------------------------------------------

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
      }}
      className="fixed inset-0 z-10 bg-black text-white"
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

// Yüklenemeyen fotoğrafta (ör. erişilemeyen depolama bağlantısı) kırık görsel
// yerine sade bir yer tutucu gösterilir
function PhotoImage({ src, sizes, className }: { src: string; sizes: string; className: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="absolute inset-0 flex items-center justify-center text-[13px] text-[#8A9099]">
        Fotoğraf yüklenemedi
      </span>
    );
  }

  return (
    <Image src={src} alt="" fill sizes={sizes} className={className} onError={() => setFailed(true)} />
  );
}

// ---------------------------------------------------------------
// İkonlar
// ---------------------------------------------------------------

type IconProps = { className?: string };

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps} className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function ChevronIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps} className={className} aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function ChatIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps} className={className} aria-hidden="true">
      <path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.55L3.5 20.5l1.45-4.35A8.5 8.5 0 1 1 20.5 11.5Z" />
    </svg>
  );
}
