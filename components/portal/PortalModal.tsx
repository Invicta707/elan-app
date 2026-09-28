"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { bodyFont, displayFont } from "../../app/fonts";
import { modalKeyStep, type PortalVehicle } from "../../lib/portal";
import { primeSellerProfiles } from "../../lib/use-follow";
import DesktopFeedPanel from "../feed/DesktopFeedPanel";
import PortalPlayer from "./PortalPlayer";

// Vitrin penceresi (Shorts / lightbox, bölünmüş görünüm): solda 9:16 büyük
// video, sağda ilanın künyesi (fiyat, ekspertiz, fotoğraflar, satıcı kartı,
// WhatsApp / Ara / Mesaj) ve altta yorumlar + yazma alanı (masaüstü yan
// panelinin aynısı). ↑/↓ listedeki önceki/sonraki ilana geçer. Esc, X ya da
// dışarı tıklamak kapatır; sayfa yenilenmez, vitrin olduğu yerde kalır.
// Yerel <dialog>: odak içeride kalır, arkası inert.

export default function PortalModal({
  vehicle,
  position,
  total,
  moreAvailable,
  hasPrev,
  hasNext,
  loadingNext,
  neighborSellerIds,
  muted,
  onMutedChange,
  onStep,
  onClose,
}: {
  vehicle: PortalVehicle;
  /** Listede kaçıncı (1'den); liste dışından açıldıysa (bağlantı) null */
  position: number | null;
  total: number;
  /** Listenin devamı var (sayaçta "+") */
  moreAvailable: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  /** Sonraki ilan için yeni sayfa bekleniyor */
  loadingNext: boolean;
  /** Önceki/sonraki ilanın satıcısı: kartı geçişte beklemesin */
  neighborSellerIds: (string | null)[];
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  onStep: (step: -1 | 1) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [dialogElement, setDialogElement] = useState<HTMLDialogElement | null>(null);
  const onStepRef = useRef(onStep);
  useEffect(() => {
    onStepRef.current = onStep;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // Odak pencerenin kendisinde başlar (ilk düğmede halka görünmesin); ↑/↓ hemen çalışır
    dialog.focus({ preventScroll: true });

    // Arkadaki vitrin kaymasın; kaydırma çubuğunun yeri korunur (sayfa yana kaymaz)
    const root = document.documentElement;
    const previous = { overflow: root.style.overflow, gutter: root.style.scrollbarGutter };
    root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous.overflow;
      root.style.scrollbarGutter = previous.gutter;
    };
  }, []);

  // Klavye: pencere en üstteyken ↑/↓ (yazı alanında, seçim kutusunda, tam ekran
  // fotoğrafta ve içteki pencerelerde değil). Odak içeride olmayan bir yere
  // düşse de (tıklanan düz metin) çalışsın diye belgeyi dinler.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog?.open) return;
      const openDialogs = document.querySelectorAll("dialog[open]");
      if (openDialogs[openDialogs.length - 1] !== dialog) return;
      const step = modalKeyStep(event);
      if (!step) return;
      event.preventDefault();
      onStepRef.current(step);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Satıcı kartı (ad, avatar, takip): gösterilen ve komşu ilanların satıcıları
  const sellerKey = [vehicle.sellerId, ...neighborSellerIds].join(",");
  useEffect(() => {
    void primeSellerProfiles(sellerKey.split(","));
  }, [sellerKey]);

  function close() {
    dialogRef.current?.close();
  }

  // İçteki pencerelerin (giriş, şikayet, yorum şikayeti) close olayı React
  // ağacında buraya da iletilir: yalnızca bu pencerenin kendi olayı kapatır
  function handleClose(event: SyntheticEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return;
    onClose();
  }

  const title = `${vehicle.year} ${vehicle.brandName} ${vehicle.modelName}`;

  return createPortal(
    <dialog
      ref={(element) => {
        dialogRef.current = element;
        if (element !== dialogElement) setDialogElement(element);
      }}
      aria-label={`${title} ilanı`}
      tabIndex={-1}
      onClose={handleClose}
      // Karartılmış alana tıklamak kapatır
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      data-portal-modal=""
      className={`${displayFont.variable} ${bodyFont.variable} m-auto h-[min(92dvh,56rem)] max-h-none w-fit max-w-[96vw] overflow-hidden rounded-2xl bg-[#121212] p-0 text-white ring-1 ring-[#27272A] [font-family:var(--font-body)] backdrop:bg-black/80 focus-visible:outline-none motion-safe:animate-[fade-in_160ms_ease-out]`}
    >
      <div className="flex h-full">
        <div className="relative aspect-[9/16] h-full shrink-0 bg-black">
          <PortalPlayer key={vehicle.id} vehicle={vehicle} muted={muted} onMutedChange={onMutedChange} />
        </div>

        <section aria-label="İlan ayrıntıları ve yorumlar" className="flex h-full w-[400px] min-w-0 flex-col border-l border-[#27272A] xl:w-[440px]">
          <div className="flex h-14 shrink-0 items-center gap-1 border-b border-[#27272A] px-3">
            <p aria-live="polite" className="min-w-0 flex-1 truncate pl-1 text-[13.5px] text-[#A1A1AA]">
              {position !== null ? (
                <>
                  <span className="font-semibold text-white tabular-nums">{position}</span>
                  <span className="tabular-nums">
                    {" "}
                    / {total}
                    {moreAvailable ? "+" : ""}
                  </span>
                  <span className="sr-only"> ilan</span>
                </>
              ) : (
                "Paylaşılan ilan"
              )}
            </p>
            <button
              type="button"
              onClick={() => onStep(-1)}
              disabled={!hasPrev}
              aria-label="Önceki ilan"
              title="Önceki ilan (↑)"
              className={toolbarButton}
            >
              <ChevronUp aria-hidden="true" className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => onStep(1)}
              disabled={!hasNext}
              aria-busy={loadingNext}
              aria-label="Sonraki ilan"
              title="Sonraki ilan (↓)"
              className={toolbarButton}
            >
              <ChevronDown aria-hidden="true" className={`h-5 w-5 ${loadingNext ? "motion-safe:animate-pulse" : ""}`} />
            </button>
            <button type="button" onClick={close} aria-label="Pencereyi kapat" title="Kapat (Esc)" className={`${toolbarButton} ml-1`}>
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>

          <DesktopFeedPanel vehicle={vehicle} lightboxContainer={dialogElement} />
        </section>
      </div>
    </dialog>,
    document.body,
  );
}

const toolbarButton =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-[#52525B] disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";
