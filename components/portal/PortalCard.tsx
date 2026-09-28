"use client";

import { MapPin } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { PREVIEW_DELAY_MS, PREVIEW_LOOP_SECONDS, formatListingDate, previewLoopTime, type PortalVehicle } from "../../lib/portal";
import { formatAmount } from "../../lib/search";
import { vehiclePath } from "../../lib/share";
import { useHlsVideo } from "../../lib/use-hls-video";
import VideoPlayMark from "../brand/VideoPlayMark";
import PricePlate from "../vehicle/PricePlate";

// Masaüstü vitrin kartı: 9:16 kapak, ortada saydam göz-oynat işareti, altında
// başlık, fiyat, yıl/km, il ve eklenme günü. Fare üstünde kısa süre kalınca
// video sessizce ilk saniyelerini döngüyle oynatır; fare çekilince video
// öğesi kaldırılır (hls.js yok edilir, kaynak bırakılır) ve kapağa dönülür.
// Tıklamak Shorts oynatıcısını açar; bağlantı ilan sayfasına gider (orta tık /
// Ctrl+tık yeni sekmede ilan sayfası).

export default function PortalCard({
  vehicle,
  eager,
  previewEnabled,
  onOpen,
  linkRef,
  now,
}: {
  vehicle: PortalVehicle;
  /** İlk satırdaki kartların kapağı beklemeden yüklenir */
  eager: boolean;
  /** Pencere açıkken önizleme yok */
  previewEnabled: boolean;
  onOpen: () => void;
  /** Pencere kapanınca odak bu karta döner */
  linkRef?: (element: HTMLAnchorElement | null) => void;
  /** "Bugün", "Dün" hesabı (bütün kartlarda aynı an) */
  now: Date;
}) {
  const [hovered, setHovered] = useState(false);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<number | null>(null);
  const previewing = hovered && previewEnabled && Boolean(vehicle.hlsUrl);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  function handlePointerEnter(event: PointerEvent<HTMLAnchorElement>) {
    // Dokunmatik ekranda üstünde durma yok: dokunuş doğrudan pencereyi açar
    if (event.pointerType !== "mouse" || !vehicle.hlsUrl) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setHovered(true);
    }, PREVIEW_DELAY_MS);
  }

  function handlePointerLeave() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHovered(false);
    setPlaying(false);
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // Yeni sekme / pencere isteği: tarayıcıya bırak (ilan sayfası)
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    handlePointerLeave();
    onOpen();
  }

  const title = `${vehicle.brandName} ${vehicle.modelName}`;
  const date = vehicle.createdAt ? formatListingDate(vehicle.createdAt, now) : "";
  const place = [vehicle.city, date].filter(Boolean).join(" · ");
  const showPlaying = previewing && playing;

  return (
    <a
      ref={linkRef}
      href={vehiclePath(vehicle.id)}
      onClick={handleClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      aria-haspopup="dialog"
      data-portal-card={vehicle.id}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-[#121212]"
    >
      <span className="relative block aspect-[9/16] overflow-hidden rounded-xl bg-[#18181B] ring-1 ring-inset ring-[#27272A]">
        {vehicle.posterUrl ? (
          <Image
            src={vehicle.posterUrl}
            alt=""
            fill
            sizes="(min-width: 1280px) 20vw, 25vw"
            loading={eager ? "eager" : "lazy"}
            className="object-cover transition-transform duration-300 ease-out motion-safe:group-hover:scale-[1.02]"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[13px] text-[#71717A]">Görsel yok</span>
        )}

        {previewing && vehicle.hlsUrl && <PreviewVideo url={vehicle.hlsUrl} onPlaying={() => setPlaying(true)} />}

        {/* Oynat işareti: yalnızca yarı saydam göz hattı ve oynat üçgeni (zemin dairesi yok); önizleme oynarken kaybolur */}
        {vehicle.hlsUrl && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span
              data-play-mark={showPlaying ? "hidden" : "visible"}
              className={`transition-opacity duration-200 ${showPlaying ? "opacity-0" : "opacity-100"}`}
            >
              <VideoPlayMark />
            </span>
          </span>
        )}

        <ListingBadges isTest={vehicle.isTest} hasHeavyDamage={vehicle.hasHeavyDamage} />
      </span>

      <span className="mt-2.5 block px-0.5">
        <span className="block truncate text-[16px] font-semibold leading-tight text-white [font-family:var(--font-display)]">
          {title}
        </span>
        <PricePlate price={vehicle.price} currency={vehicle.currency} size="sm" className="mt-1.5" />
        <span className="mt-1.5 block truncate text-[13px] text-[#D4D4D8]">
          {vehicle.year} · {formatAmount(vehicle.mileageKm)} km
        </span>
        {place && (
          <span className="mt-0.5 flex items-center gap-1 text-[13px] text-[#A1A1AA]">
            <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{place}</span>
          </span>
        )}
        <span className="sr-only">, videoyu ve ayrıntıları aç</span>
      </span>
    </a>
  );
}

/** Kartın üstünde, sessiz ve kısa döngülü önizleme; kaldırılınca kaynağı bırakır */
function PreviewVideo({ url, onPlaying }: { url: string; onPlaying: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);

  useHlsVideo(videoRef, url, {
    // Döngü ilk saniyelerde: fazlasını indirmeye gerek yok
    maxBufferLength: PREVIEW_LOOP_SECONDS + 2,
    onAttached: (video) => {
      video.muted = true;
      video.play().catch(() => {
        // Otomatik oynatma engellendiyse kapak kalır
      });
    },
  });

  return (
    <video
      ref={videoRef}
      aria-hidden="true"
      tabIndex={-1}
      muted
      playsInline
      loop
      preload="auto"
      data-preview-video=""
      onPlaying={() => {
        setVisible(true);
        onPlaying();
      }}
      onTimeUpdate={(event) => {
        const restart = previewLoopTime(event.currentTarget.currentTime);
        if (restart !== null) event.currentTarget.currentTime = restart;
      }}
      className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

/** Kapağın sol üstünde: deneme ilanı ve ağır hasar etiketleri (görselli ilan kartı da kullanır) */
export function ListingBadges({ isTest, hasHeavyDamage }: { isTest: boolean; hasHeavyDamage: boolean }) {
  if (!isTest && !hasHeavyDamage) return null;
  return (
    <span className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1">
      {isTest && (
        <span className="rounded-md bg-black/70 px-1.5 py-0.5 text-[12px] font-semibold text-white ring-1 ring-inset ring-white/20">
          Test ilanı
        </span>
      )}
      {hasHeavyDamage && <span className="rounded-md bg-[#E5484D] px-1.5 py-0.5 text-[12px] font-semibold text-white">Ağır hasar</span>}
    </span>
  );
}
