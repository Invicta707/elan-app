"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bodyFont, displayFont } from "../app/fonts";
import { fetchVehicleDetails, type FeedVehicle, type VehicleDetails } from "../lib/feed";
import { buildVehicleShareText } from "../lib/vehicle-page";
import FavoriteButton from "./FavoriteButton";
import BodyDiagram from "./vehicle/BodyDiagram";
import ConditionList from "./vehicle/ConditionList";
import MessageSellerButton from "./vehicle/MessageSellerButton";
import PhotoGallery, { GallerySkeleton } from "./vehicle/PhotoGallery";
import ShareButton from "./vehicle/ShareButton";
import SpecsTable, { formatVehiclePrice } from "./vehicle/SpecsTable";
import WhatsAppButton from "./vehicle/WhatsAppButton";

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
  const [messageNotice, setMessageNotice] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const lightboxOpenRef = useRef(false);
  const titleId = useId();

  // Tam ekran fotoğraf görüntüleyici dialog'un içine çizilir (dışı inert)
  const [dialogEl, setDialogEl] = useState<HTMLDialogElement | null>(null);
  const [isShown, setShown] = useState(false);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [isLightboxOpen, setLightboxOpen] = useState(false);

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

  function retry() {
    setLoad({ status: "loading" });
    setReloadKey((key) => key + 1);
  }

  const details = load.status === "ready" ? load.details : null;
  const title = `${vehicle.brandName} ${vehicle.modelName}`;
  const price = formatVehiclePrice(vehicle.price, vehicle.currency);

  return (
    <dialog
      ref={(el) => {
        dialogRef.current = el;
        setDialogEl(el);
      }}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        // Esc: tam ekran fotoğraf açıksa onu görüntüleyici kapatır; değilse çekmece (animasyonla)
        event.preventDefault();
        if (!lightboxOpenRef.current) requestClose();
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
        inert={isLightboxOpen}
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
            <div className="-mr-1 flex shrink-0 items-center gap-2">
              <FavoriteButton vehicleId={vehicle.id} variant="sheet" />
              <button
                type="button"
                onClick={requestClose}
                aria-label="Detayları kapat"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F2F3F5] hover:bg-[#E6E8EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5">
          {load.status === "loading" && (
            <div className="mb-5">
              <GallerySkeleton />
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

          {details && details.photoUrls.length > 0 && (
            <div className="mb-5">
              <PhotoGallery
                photos={details.photoUrls}
                title={title}
                lightboxContainer={dialogEl}
                onLightboxChange={(open) => {
                  lightboxOpenRef.current = open;
                  setLightboxOpen(open);
                }}
              />
            </div>
          )}

          <SpecsTable
            headingId={`${titleId}-specs`}
            specs={{
              ...vehicle,
              // undefined: kasa tipi henüz yükleniyor
              bodyType: load.status === "loading" ? undefined : (details?.bodyType ?? null),
            }}
          />

          {/* Ekspertiz özeti: akış kartı artık yalnızca fiyat, yıl, km ve şehri gösteriyor */}
          <section aria-labelledby={`${titleId}-condition`} className="mt-5">
            <h3 id={`${titleId}-condition`} className="mb-2 text-[15px] font-semibold">
              Ekspertiz
            </h3>
            <div className="rounded-lg border border-[#E3E6EA] bg-white px-3 pt-2.5 pb-3">
              <ConditionList vehicle={vehicle} tone="light" />
              <BodyDiagram counts={vehicle} parts={details?.bodyParts} tone="light" className="mt-4" />
            </div>
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
            {(messageNotice ?? notice) && (
              <p className="mb-2 text-center text-[13px] text-[#B42318]">{messageNotice ?? notice}</p>
            )}
          </div>
          {/* İki iletişim yolu eşit ağırlıkta; paylaş yalnızca simge */}
          <div className="@container flex gap-2">
            <ShareButton
              vehicleId={vehicle.id}
              title={title}
              text={buildVehicleShareText(vehicle)}
              variant="icon"
              className="shrink-0"
            />
            <MessageSellerButton vehicleId={vehicle.id} onNotice={setMessageNotice} className="min-w-0 flex-1" />
            <WhatsAppButton onClick={onContact} isContacting={isContacting} className="min-w-0 flex-1" />
          </div>
        </div>
      </div>
    </dialog>
  );
}

function CloseIcon({ className }: { className?: string }) {
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
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
