"use client";

import { ArrowLeft, ChevronDown, ChevronUp, Images, MessageCircle, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { bodyFont, displayFont } from "../../app/fonts";
import { createWheelStepper } from "../../lib/feed-navigation";
import { partnerName } from "../../lib/messages";
import { modalKeyStep, type PortalVehicle } from "../../lib/portal";
import { formatCount } from "../../lib/showcase";
import { useCommentCount } from "../../lib/use-comment-counts";
import { primeSellerProfiles, useSellerProfile } from "../../lib/use-follow";
import { profilePath } from "../../lib/username";
import { buildVehicleShareText } from "../../lib/vehicle-page";
import FavoriteButton from "../FavoriteButton";
import DesktopFeedPanel from "../feed/DesktopFeedPanel";
import { SHORTS_BUTTON, SHORTS_ICON, SHORTS_ICON_BOX, SHORTS_LABEL } from "../feed/actionStyles";
import Avatar from "../ui/Avatar";
import PricePlate from "../vehicle/PricePlate";
import ShareButton from "../vehicle/ShareButton";
import WhatsAppIcon from "../vehicle/WhatsAppIcon";
import { useSellerContact } from "../vehicle/useSellerContact";
import ShortsPlayer, { type ShortsPlayerControl } from "./ShortsPlayer";

// Masaüstü Shorts oynatıcısı (YouTube Shorts / TikTok Web modeli): vitrinde
// bir karta tıklanınca tam ekran açılır. Ortada ekran yüksekliğinde 9:16
// video, sağında sütun (Beğen, Yorum, Paylaş, WhatsApp, Detaylar), videonun
// sol altında satıcı, başlık ve fiyat. ↑/↓, fare tekerleği (bir hareket bir
// ilan) ya da sağdaki oklar kartın bölümündeki önceki/sonraki ilana kayarak
// geçer. Esc ya da sol üstteki geri düğmesi kapatır; vitrin olduğu yerde kalır
// (DesktopPortal odağı son izlenen karta verir). Künye (satıcı kartı,
// WhatsApp / Ara / Mesaj, araç bilgileri, ekspertiz, açıklama, fotoğraflar,
// yorumlar) sağdan açılan "İlan detayı" çekmecesinde; video izlenirken
// kapalıdır. Yerel <dialog>: odak içeride kalır, arkası inert.

/** Dikey geçişin süresi (globals.css shorts-* animasyonları) */
export const SLIDE_MS = 320;

/**
 * Video çerçevesinin yüksekliği: ekran yüksekliğinden 2rem az; dar alanda
 * (çekmece açıkken 1024 px gibi) çerçeve + iki yandaki 56 px sütun + sağdaki
 * oklar sığsın diye genişlikten hesaplanır. Sahne bir boyut kabı (cq birimleri).
 */
const FRAME_HEIGHT = "min(calc(100cqh - 2rem), calc((100cqw - 20rem) * 16 / 9))";

const ENTER: Record<1 | -1, string> = {
  1: "motion-safe:animate-[shorts-enter-next_320ms_cubic-bezier(0.2,0.8,0.2,1)_both]",
  [-1]: "motion-safe:animate-[shorts-enter-prev_320ms_cubic-bezier(0.2,0.8,0.2,1)_both]",
};
const LEAVE: Record<1 | -1, string> = {
  1: "motion-safe:animate-[shorts-leave-next_320ms_cubic-bezier(0.2,0.8,0.2,1)_both]",
  [-1]: "motion-safe:animate-[shorts-leave-prev_320ms_cubic-bezier(0.2,0.8,0.2,1)_both]",
};

type Leaving = { vehicle: PortalVehicle; direction: 1 | -1 };

export default function ShortsViewer({
  vehicle,
  direction,
  position,
  total,
  moreAvailable,
  hasPrev,
  hasNext,
  loadingNext,
  neighbors,
  muted,
  onMutedChange,
  onStep,
  onClose,
}: {
  vehicle: PortalVehicle;
  /** Bu ilana hangi adımla gelindi: 1 sonraki, -1 önceki (kayarak geçiş), 0 ilk açılış */
  direction: -1 | 0 | 1;
  /** Listede kaçıncı (1'den); liste dışından açıldıysa (bağlantı) null */
  position: number | null;
  total: number;
  /** Listenin devamı var (sayaçta "+") */
  moreAvailable: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  /** Sonraki ilan için yeni sayfa bekleniyor */
  loadingNext: boolean;
  /** Önceki/sonraki ilan: kapakları ve satıcıları geçişi beklemesin diye önceden istenir */
  neighbors: { prev: PortalVehicle | null; next: PortalVehicle | null };
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  onStep: (step: -1 | 1) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [dialogElement, setDialogElement] = useState<HTMLDialogElement | null>(null);
  const playerRef = useRef<ShortsPlayerControl | null>(null);
  const wheelStepRef = useRef<ReturnType<typeof createWheelStepper> | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [commentsRequest, setCommentsRequest] = useState(0);

  // Gösterilen ilan değişince eskisi ters yöne kayarak çıkar (SLIDE_MS sonra kalkar)
  const [shown, setShown] = useState(vehicle);
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  if (shown.id !== vehicle.id) {
    setShown(vehicle);
    setLeaving(direction === 0 ? null : { vehicle: shown, direction });
    // Yorum isteği yeni ilanın panelinde yinelenmesin (çekmece açık kalır)
    setCommentsRequest(0);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(null), SLIDE_MS + 60);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  const onStepRef = useRef(onStep);
  useEffect(() => {
    onStepRef.current = onStep;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // Odak oynatıcının kendisinde başlar (ilk düğmede halka görünmesin); ↑/↓ ve boşluk hemen çalışır
    dialog.focus({ preventScroll: true });

    // Arkadaki vitrin kaymasın; kaydırma çubuğunun yeri korunur (kapanınca vitrin olduğu yerde)
    const root = document.documentElement;
    const previous = { overflow: root.style.overflow, gutter: root.style.scrollbarGutter };
    root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous.overflow;
      root.style.scrollbarGutter = previous.gutter;
    };
  }, []);

  // Klavye: oynatıcı en üstteyken ↑/↓ önceki/sonraki ilan, boşluk durdur/oynat.
  // Yazı alanında, çekmecede, tam ekran fotoğrafta ve içteki pencerelerde değil.
  // Odak içeride olmayan bir yere düşse de çalışsın diye belgeyi dinler.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog?.open) return;
      const openDialogs = document.querySelectorAll("dialog[open]");
      if (openDialogs[openDialogs.length - 1] !== dialog) return;
      if (event.key === " " && isPlainTarget(event)) {
        event.preventDefault();
        playerRef.current?.togglePlay();
        return;
      }
      const step = modalKeyStep(event);
      if (!step) return;
      event.preventDefault();
      onStepRef.current(step);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Komşu ilanların kapakları (geçişte videonun posteri hemen görünsün) ve satıcıları
  const prevPoster = neighbors.prev?.posterUrl ?? null;
  const nextPoster = neighbors.next?.posterUrl ?? null;
  useEffect(() => {
    for (const url of [nextPoster, prevPoster]) {
      if (!url) continue;
      const image = new window.Image();
      image.src = url;
    }
  }, [prevPoster, nextPoster]);
  const sellerKey = [vehicle.sellerId, neighbors.prev?.sellerId, neighbors.next?.sellerId].join(",");
  useEffect(() => {
    void primeSellerProfiles(sellerKey.split(","));
  }, [sellerKey]);

  function close() {
    dialogRef.current?.close();
  }

  // İçteki pencerelerin (giriş, şikayet, tam ekran fotoğraf) close olayı React
  // ağacında buraya da iletilir: yalnızca bu pencerenin kendi olayı kapatır
  function handleClose(event: SyntheticEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return;
    onClose();
  }

  function step(delta: -1 | 1) {
    if (delta === -1 ? !hasPrev : !hasNext) return;
    onStep(delta);
  }

  // Fare tekerleği / dokunmatik yüzey: bir hareket bir ilan (Ctrl+tekerlek yakınlaştırmaya kalır)
  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (event.ctrlKey) return;
    wheelStepRef.current ??= createWheelStepper();
    const delta = wheelStepRef.current(event.deltaX, event.deltaY, performance.now());
    if (delta) step(delta);
  }

  function openComments() {
    setDrawerOpen(true);
    setCommentsRequest((request) => request + 1);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    // Kapatma düğmesi kalkınca odak oynatıcıya döner (↑/↓ çalışmaya devam eder)
    dialogRef.current?.focus({ preventScroll: true });
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
      data-shorts-viewer=""
      className={`${displayFont.variable} ${bodyFont.variable} fixed inset-0 m-0 h-auto max-h-none w-screen max-w-none overflow-hidden bg-[#0F0F10] p-0 text-white [font-family:var(--font-body)] backdrop:bg-black focus-visible:outline-none motion-safe:animate-[fade-in_160ms_ease-out]`}
    >
      <div className="flex h-full">
        <div className="relative h-full min-w-0 flex-1">
          <div data-shorts-stage="" onWheel={handleWheel} className="relative h-full overflow-hidden [container-type:size]">
            {leaving && (
              <SlideFrame key={`giden-${leaving.vehicle.id}`} className={`motion-reduce:hidden ${LEAVE[leaving.direction]}`} inert>
                <div className="relative shrink-0 overflow-hidden rounded-2xl bg-black" style={{ height: FRAME_HEIGHT, aspectRatio: "9 / 16" }}>
                  {leaving.vehicle.posterUrl && (
                    <Image src={leaving.vehicle.posterUrl} alt="" fill unoptimized sizes="600px" className="object-cover" />
                  )}
                  <InfoOverlay vehicle={leaving.vehicle} />
                </div>
                <span aria-hidden="true" className="w-14 shrink-0" />
              </SlideFrame>
            )}

            <SlideFrame key={vehicle.id} className={leaving ? ENTER[leaving.direction] : ""} current>
              <div
                data-shorts-frame=""
                className="relative shrink-0 overflow-hidden rounded-2xl bg-black"
                style={{ height: FRAME_HEIGHT, aspectRatio: "9 / 16" }}
              >
                <ShortsPlayer vehicle={vehicle} muted={muted} onMutedChange={onMutedChange} controlRef={playerRef} />
                <InfoOverlay vehicle={vehicle} onOpenDetails={() => setDrawerOpen(true)} />
              </div>
              <ActionColumn
                vehicle={vehicle}
                drawerOpen={drawerOpen}
                onComments={openComments}
                onToggleDetails={() => (drawerOpen ? closeDrawer() : setDrawerOpen(true))}
              />
            </SlideFrame>
          </div>

          <div className="absolute top-4 left-4 z-20 flex items-center gap-3">
            <button type="button" onClick={close} aria-label="Vitrine dön" title="Vitrine dön (Esc)" className={roundButton}>
              <ArrowLeft aria-hidden="true" className="h-5 w-5" />
            </button>
            <p aria-live="polite" data-shorts-counter="" className="text-[13.5px] text-[#A1A1AA]">
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
          </div>

          <div className="absolute top-1/2 right-6 z-20 flex -translate-y-1/2 flex-col gap-3">
            <button type="button" onClick={() => step(-1)} disabled={!hasPrev} aria-label="Önceki ilan" title="Önceki ilan (↑)" className={navButton}>
              <ChevronUp aria-hidden="true" className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={!hasNext}
              aria-busy={loadingNext}
              aria-label="Sonraki ilan"
              title="Sonraki ilan (↓)"
              className={navButton}
            >
              <ChevronDown aria-hidden="true" className={`h-6 w-6 ${loadingNext ? "motion-safe:animate-pulse" : ""}`} />
            </button>
          </div>
        </div>

        {/* "İlan detayı" çekmecesi: yalnızca açıkken kurulur (künye ve yorumlar o zaman istenir) */}
        <aside
          id="shorts-drawer"
          aria-label="İlan detayı"
          data-own-keys=""
          data-open={drawerOpen ? "true" : "false"}
          className={`h-full shrink-0 overflow-hidden bg-[#121212] transition-[width] duration-300 ease-out motion-reduce:transition-none ${
            drawerOpen ? "w-[400px] border-l border-[#27272A] xl:w-[440px]" : "w-0"
          }`}
        >
          {drawerOpen && (
            <div className="flex h-full w-[400px] flex-col xl:w-[440px]">
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#27272A] pr-2 pl-4">
                <h2 className="text-[16px] font-semibold">İlan detayı</h2>
                <button type="button" onClick={closeDrawer} aria-label="İlan detayını kapat" title="Kapat" className={drawerCloseButton}>
                  <X aria-hidden="true" className="h-5 w-5" />
                </button>
              </div>
              <DesktopFeedPanel vehicle={vehicle} lightboxContainer={dialogElement} commentsRequest={commentsRequest} />
            </div>
          )}
        </aside>
      </div>
    </dialog>,
    document.body,
  );
}

/** Boşluk tuşu oynatmayı değiştirir: odak bir düğmede, bağlantıda, alanda ya da çekmecede değilse */
function isPlainTarget(event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return false;
  const target = event.target as Element | null;
  if (!target || typeof target.closest !== "function") return true;
  return !target.closest("button, a, input, textarea, select, [contenteditable], [data-own-keys], [role='dialog'][aria-modal='true']");
}

/** Bir ilanın satırı: çerçeve ortada (solda sütun genişliğinde boşluk), sütun sağında, alt kenarı çerçeveyle hizalı */
function SlideFrame({
  className,
  current = false,
  inert = false,
  children,
}: {
  className: string;
  current?: boolean;
  inert?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-shorts-slide={current ? "current" : "leaving"}
      aria-hidden={inert || undefined}
      inert={inert}
      className={`absolute inset-0 flex items-center justify-center ${className}`}
    >
      <div className="flex items-end gap-4">
        <span aria-hidden="true" className="w-14 shrink-0" />
        {children}
      </div>
    </div>
  );
}

/** Videonun sol altı: satıcı, başlık, fiyat (sade; künye çekmecede) */
function InfoOverlay({ vehicle, onOpenDetails }: { vehicle: PortalVehicle; onOpenDetails?: () => void }) {
  const title = `${vehicle.brandName} ${vehicle.modelName}`;
  return (
    <div
      data-shorts-info=""
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-[linear-gradient(to_top,rgba(0,0,0,0.6)_0%,rgba(0,0,0,0.25)_60%,rgba(0,0,0,0)_100%)] px-4 pt-20 pb-6"
    >
      <SellerLine sellerId={vehicle.sellerId} interactive={Boolean(onOpenDetails)} />
      <h2 className="mt-2 text-[22px] font-semibold leading-tight [font-family:var(--font-display)] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
        {onOpenDetails ? (
          <button
            type="button"
            onClick={onOpenDetails}
            aria-controls="shorts-drawer"
            className="pointer-events-auto block max-w-full truncate rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {title}
          </button>
        ) : (
          <span className="block truncate">{title}</span>
        )}
      </h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <PricePlate price={vehicle.price} currency={vehicle.currency} size="sm" />
        {vehicle.isTest && (
          <span className="rounded-md bg-black/55 px-1.5 py-0.5 text-[12px] font-semibold ring-1 ring-inset ring-white/20">Test ilanı</span>
        )}
      </div>
    </div>
  );
}

/** Satıcının avatarı ve adı (kullanıcı adı varsa vitrinine gider) */
function SellerLine({ sellerId, interactive }: { sellerId: string | null; interactive: boolean }) {
  const seller = useSellerProfile(sellerId);
  // Satıcı gelene kadar yer tutulur: başlık ve fiyat kaymaz
  if (!seller) return <span aria-hidden="true" className="block h-8" />;

  const name = partnerName(seller, "buyer");
  const content = (
    <>
      <Avatar url={seller.avatarUrl} name={seller.displayName ?? seller.username} size={32} />
      <span className="truncate text-[15px] font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">{name}</span>
    </>
  );
  if (interactive && seller.username) {
    return (
      <Link
        href={profilePath(seller.username)}
        aria-label={`Satıcı: ${name}, vitrini aç`}
        className="pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-full pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        {content}
      </Link>
    );
  }
  return <span className="inline-flex max-w-full items-center gap-2">{content}</span>;
}

/** Videonun sağındaki sütun: Beğen, Yorum, Paylaş, WhatsApp, Detaylar */
function ActionColumn({
  vehicle,
  drawerOpen,
  onComments,
  onToggleDetails,
}: {
  vehicle: PortalVehicle;
  drawerOpen: boolean;
  onComments: () => void;
  onToggleDetails: () => void;
}) {
  // Sayı çekmecedeki yorum listesiyle ortak depoda (lib/use-comment-counts.ts)
  const commentsCount = useCommentCount(vehicle.id, vehicle.commentsCount);
  const { contact, isContacting, notice } = useSellerContact(vehicle);
  const title = `${vehicle.brandName} ${vehicle.modelName}`;

  return (
    <div role="group" aria-label="İlan işlemleri" className="relative flex w-14 shrink-0 flex-col items-center gap-4 pb-4">
      <FavoriteButton vehicleId={vehicle.id} variant="shorts" />

      <button
        type="button"
        onClick={onComments}
        aria-controls="shorts-drawer"
        aria-label={commentsCount > 0 ? `Yorumlar (${commentsCount})` : "Yorumlar"}
        className={SHORTS_BUTTON}
      >
        <span className={SHORTS_ICON_BOX}>
          <MessageCircle aria-hidden="true" className={SHORTS_ICON} strokeWidth={2.2} />
        </span>
        <span aria-hidden="true" className={`tabular-nums ${SHORTS_LABEL}`}>
          {commentsCount > 0 ? formatCount(commentsCount) : "Yorum"}
        </span>
      </button>

      <ShareButton vehicleId={vehicle.id} title={title} text={buildVehicleShareText(vehicle)} variant="shorts" />

      <button
        type="button"
        onClick={() => void contact()}
        disabled={isContacting}
        aria-busy={isContacting}
        aria-label="WhatsApp'tan yaz"
        className={`${SHORTS_BUTTON} disabled:opacity-70`}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#25D366] text-[#062612] motion-safe:transition-transform motion-safe:group-active:scale-95">
          <WhatsAppIcon className="h-6 w-6" />
        </span>
        <span aria-hidden="true" className={SHORTS_LABEL}>
          {isContacting ? "Açılıyor" : "WhatsApp"}
        </span>
      </button>

      <button type="button" onClick={onToggleDetails} aria-expanded={drawerOpen} aria-controls="shorts-drawer" className={SHORTS_BUTTON}>
        <span className={drawerOpen ? DETAILS_OPEN_BOX : SHORTS_ICON_BOX}>
          <Images aria-hidden="true" className={SHORTS_ICON} />
        </span>
        <span className={SHORTS_LABEL}>Detaylar</span>
      </button>

      <div role="status" aria-live="polite" className="absolute right-full bottom-4 mr-3 w-max max-w-[16rem]">
        {notice && <p className="rounded-md bg-[#15181C]/90 px-3 py-2 text-[13px] leading-snug text-white">{notice}</p>}
      </div>
    </div>
  );
}

const roundButton =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#27272A] text-white transition-colors hover:bg-[#3F3F46] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

const navButton =
  "flex h-12 w-12 items-center justify-center rounded-full bg-[#27272A] text-white transition-colors hover:bg-[#3F3F46] disabled:cursor-not-allowed disabled:bg-[#18181B] disabled:text-[#52525B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

const drawerCloseButton =
  "flex h-10 w-10 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

/** Çekmece açıkken "Detaylar" dairesi beyaz (açık olduğu görünsün) */
const DETAILS_OPEN_BOX = "flex h-12 w-12 items-center justify-center rounded-full bg-white text-[#121212] transition-colors";
