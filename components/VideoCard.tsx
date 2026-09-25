"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type Hls from "hls.js";
import FavoriteButton from "./FavoriteButton";
import VehicleDetailSheet from "./VehicleDetailSheet";
import { useSellerContact } from "./vehicle/useSellerContact";
import type { FeedVehicle } from "../lib/feed";
import { FUEL_LABELS, TRANSMISSION_LABELS } from "../lib/vehicle-labels";

type VideoCardProps = {
  vehicle: FeedVehicle;
  /** Ekranın en az %60'ını kaplayan kart: oynatılır */
  isActive: boolean;
  /** Aktif kart ve hemen önceki/sonraki kart: HLS kaynağı bağlanır (ön yükleme) */
  shouldLoad: boolean;
  /** Ses durumu tüm kartlarda ortak, VideoFeed'de tutulur */
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
};

// Kalıcı ağ/medya hatalarında sonsuz yeniden deneme döngüsüne girmemek için
const MAX_RECOVERY_ATTEMPTS = 2;

const amountFormatter = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const tryFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});

const CURRENCIES: Record<string, { symbol: string; spoken: string }> = {
  TRY: { symbol: "₺", spoken: "TL" },
  USD: { symbol: "$", spoken: "dolar" },
  EUR: { symbol: "€", spoken: "euro" },
};

// Ekspertiz raporlarındaki parça renk kodları: orijinal / boyalı / değişen
type ConditionTone = "original" | "painted" | "changed";

const TONE_MARKERS: Record<ConditionTone, string> = {
  original: "bg-[#E9ECEF]",
  painted: "bg-[#F5A524]",
  changed: "bg-[#E5484D]",
};

function getConditionItems(v: FeedVehicle): { label: string; tone: ConditionTone }[] {
  return [
    v.paintedPartsCount === 0
      ? { label: "Boyasız", tone: "original" }
      : { label: `${v.paintedPartsCount} parça boyalı`, tone: "painted" },
    v.changedPartsCount === 0
      ? { label: "Değişensiz", tone: "original" }
      : { label: `${v.changedPartsCount} parça değişen`, tone: "changed" },
    v.tramerAmount === 0
      ? { label: "Tramer kaydı yok", tone: "original" }
      : { label: `Tramer ${tryFormatter.format(v.tramerAmount)}`, tone: "painted" },
  ];
}

export default function VideoCard({
  vehicle,
  isActive,
  shouldLoad,
  muted,
  onMutedChange,
}: VideoCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isActiveRef = useRef(isActive);
  const usingNativeHlsRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const { contact: handleContact, isContacting, notice } = useSellerContact(vehicle);
  const [isDetailsOpen, setDetailsOpen] = useState(false);

  const hasVideoError = failedUrl === vehicle.hlsUrl;

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const tryPlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      await video.play();
    } catch (error) {
      // AbortError: oynatma bir pause() ya da kaynak değişimiyle kesildi, beklenen durum
      if (!(error instanceof DOMException) || error.name !== "NotAllowedError") return;

      // Sessizken bile engellendiyse (örn. iOS Güç Tasarrufu modu) ortadaki
      // oynat simgesi görünür, kullanıcı dokununca başlar
      if (video.muted || !isActiveRef.current) return;

      // Tarayıcı sesli otomatik oynatmayı engelledi: sessize alıp tekrar dene
      video.muted = true;
      onMutedChange(true);
      try {
        await video.play();
      } catch {
        // Kullanıcı dokunduğunda tekrar denenecek
      }
    }
  }, [onMutedChange]);

  // 1) HLS kaynağını bağla / serbest bırak
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !shouldLoad) return;

    const url = vehicle.hlsUrl;
    let hls: Hls | null = null;
    let cancelled = false;
    let recoveryAttempts = 0;

    void (async () => {
      // hls.js sadece tarayıcıda ve ihtiyaç anında yüklenir: SSR'da sorun
      // çıkarmaz ve ilk JavaScript paketini küçük tutar
      const { default: HlsClass } = await import("hls.js");
      if (cancelled) return;

      if (HlsClass.isSupported()) {
        const instance = new HlsClass({
          capLevelToPlayerSize: true, // ekrandan büyük çözünürlüğü indirme
          maxBufferLength: 10, // ön yüklenen kartlar tüm klibi değil ~10 sn'yi indirsin
        });
        hls = instance;

        instance.on(HlsClass.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;

          if (recoveryAttempts < MAX_RECOVERY_ATTEMPTS) {
            recoveryAttempts += 1;
            if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) {
              instance.startLoad();
              return;
            }
            if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR) {
              instance.recoverMediaError();
              return;
            }
          }

          instance.destroy();
          hls = null;
          setFailedUrl(url);
        });

        instance.loadSource(url);
        instance.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Media Source desteği olmayan eski iOS Safari: yerleşik HLS oynatıcı
        usingNativeHlsRef.current = true;
        video.src = url;
      } else {
        setFailedUrl(url);
        return;
      }

      if (isActiveRef.current) void tryPlay();
    })();

    return () => {
      cancelled = true;
      usingNativeHlsRef.current = false;
      hls?.destroy();
      // Kaynağı tamamen bırak: uzaktaki kartlar bellek ve bant genişliği tüketmesin
      video.removeAttribute("src");
      video.load();
    };
  }, [shouldLoad, vehicle.hlsUrl, tryPlay]);

  // 2) Aktif kartsa oynat, değilse durdurup başa sar. Detay çekmecesi açıkken
  // sadece duraklatılır (başa sarılmaz); kapanınca kaldığı yerden sürer.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!isActive) {
      video.pause();
      video.currentTime = 0;
    } else if (isDetailsOpen) {
      video.pause();
    } else {
      void tryPlay();
    }
  }, [isActive, isDetailsOpen, tryPlay]);

  // 3) Ortak ses durumunu bu karta uygula
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [muted]);

  function handleTogglePlay() {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) void tryPlay();
    else video.pause();
  }

  function handleToggleMute() {
    const nextMuted = !muted;
    const video = videoRef.current;

    if (video) {
      // Dokunma olayının içinde senkron uygula: iOS, sesi ancak kullanıcı
      // hareketi sırasında açılırsa videoyu çalmaya devam ettirir
      video.muted = nextMuted;
      if (!nextMuted && video.paused && isActive) void tryPlay();
    }
    onMutedChange(nextMuted);
  }

  function handleVideoError() {
    // hls.js kendi hatalarını yönetiyor; bu olay sadece yerleşik HLS yolu için
    if (usingNativeHlsRef.current && videoRef.current?.error) {
      setFailedUrl(vehicle.hlsUrl);
    }
  }

  const currency = CURRENCIES[vehicle.currency] ?? {
    symbol: vehicle.currency,
    spoken: vehicle.currency,
  };
  const title = `${vehicle.brandName} ${vehicle.modelName}`;
  const conditionItems = getConditionItems(vehicle);
  const showPlayHint = isActive && !isPlaying && !hasVideoError;

  return (
    <article
      aria-label={`${vehicle.year} ${title}`}
      className="relative mx-auto h-full w-full max-w-[calc(100dvh*9/16)] overflow-hidden bg-black text-white"
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        poster={vehicle.thumbnailUrl ?? undefined}
        muted={muted}
        loop
        playsInline
        preload={shouldLoad ? "auto" : "none"}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={handleVideoError}
      />

      {/* Kartın tamamı: dokununca oynat / duraklat */}
      <button
        type="button"
        onClick={handleTogglePlay}
        aria-label={isPlaying ? "Videoyu duraklat" : "Videoyu oynat"}
        className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
      />

      {/* Duraklatıldığında ya da otomatik oynatma engellendiğinde görünür.
          Kısa gecikme, normal oynatma başlarken simgenin yanıp sönmesini önler. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-150 ${
          showPlayHint ? "opacity-100 delay-200" : "opacity-0"
        }`}
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45">
          <PlayIcon className="ml-1 h-7 w-7" />
        </span>
      </div>

      {hasVideoError && (
        <p className="pointer-events-none absolute inset-x-8 top-1/3 z-10 text-center text-[15px] leading-snug text-white/90">
          Bu video şu an oynatılamıyor. Sonraki ilana geçmek için kaydır.
        </p>
      )}

      {/* Bilgi katmanı: metne yapılan dokunuşlar alttaki oynat/duraklat
          butonuna geçer, sadece bu katmandaki butonlar tıklanabilir */}
      {/* Mobilde ekranın altındaki güvenli alanı alt gezinme çubuğu karşılar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-[linear-gradient(to_top,rgba(0,0,0,0.88)_0%,rgba(0,0,0,0.5)_55%,rgba(0,0,0,0)_100%)] px-4 pt-28 pb-5 md:pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <PricePlate
              price={vehicle.price}
              symbol={currency.symbol}
              spoken={currency.spoken}
            />

            <h2 className="mt-3 text-[1.75rem] font-semibold leading-none [font-family:var(--font-display)]">
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                aria-haspopup="dialog"
                className="pointer-events-auto block max-w-full truncate rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {title}
              </button>
            </h2>

            {/* Rozetlere dokunmak da detayları açar (klavye/ekran okuyucu için
                başlık ve "Detaylar" butonu var) */}
            <ul
              aria-label="Araç özellikleri"
              onClick={() => setDetailsOpen(true)}
              className="pointer-events-auto mt-2.5 flex cursor-pointer flex-wrap gap-1.5"
            >
              <Tag>{vehicle.year}</Tag>
              <Tag>{amountFormatter.format(vehicle.mileageKm)} km</Tag>
              <Tag>{FUEL_LABELS[vehicle.fuelType]}</Tag>
              <Tag>{TRANSMISSION_LABELS[vehicle.transmission]}</Tag>
              {vehicle.city && (
                <Tag icon={<PinIcon className="h-3 w-3 shrink-0" />}>{vehicle.city}</Tag>
              )}
            </ul>

            {vehicle.hasHeavyDamage && (
              <p className="mt-3 inline-flex rounded-md bg-[#E5484D] px-2 py-0.5 text-[13px] font-semibold">
                Ağır hasar kayıtlı
              </p>
            )}

            <ul
              aria-label="Ekspertiz özeti"
              className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] font-medium"
            >
              {conditionItems.map((item) => (
                <li key={item.label} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 rounded-[2px] ring-1 ring-black/40 ${TONE_MARKERS[item.tone]}`}
                  />
                  {item.label}
                </li>
              ))}
            </ul>

            <div role="status" aria-live="polite">
              {notice && (
                <p className="mt-3 max-w-[20rem] rounded-md bg-black/75 px-3 py-2 text-[13px] leading-snug">
                  {notice}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={handleContact}
              disabled={isContacting}
              aria-busy={isContacting}
              className="pointer-events-auto mt-4 inline-flex h-12 items-center gap-2 rounded-full bg-[#25D366] pl-4 pr-5 text-base font-semibold text-[#062612] disabled:opacity-70 motion-safe:transition-transform motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <ChatIcon className="h-5 w-5" />
              {isContacting ? "Açılıyor…" : "WhatsApp'tan yaz"}
            </button>
          </div>

          <div className="flex shrink-0 flex-col items-center gap-4">
            <FavoriteButton vehicleId={vehicle.id} variant="overlay" />

            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              aria-haspopup="dialog"
              aria-label="İlan detayları ve fotoğraflar"
              className="pointer-events-auto flex flex-col items-center gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45">
                <PhotosIcon className="h-5 w-5" />
              </span>
              <span aria-hidden="true" className="text-[11px] font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                Detaylar
              </span>
            </button>

            <button
              type="button"
              onClick={handleToggleMute}
              aria-label={muted ? "Sesi aç" : "Sesi kapat"}
              className="pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {muted ? <SpeakerOffIcon className="h-5 w-5" /> : <SpeakerOnIcon className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {isDetailsOpen && (
        <VehicleDetailSheet
          vehicle={vehicle}
          onClose={() => setDetailsOpen(false)}
          onContact={handleContact}
          isContacting={isContacting}
          notice={notice}
        />
      )}
    </article>
  );
}

// Yıl / km / yakıt / vites / şehir rozetleri: yarı saydam, ince bir kenarlıkla
// videonun üstünde de okunur kalan küçük etiketler
function Tag({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[12.5px] font-semibold text-white ring-1 ring-inset ring-white/20 backdrop-blur-[2px]">
      {icon}
      {children}
    </li>
  );
}

// Fiyat, Türkiye plakasından esinlenen bir etikette: soldaki mavi şeritte para birimi
function PricePlate({ price, symbol, spoken }: { price: number; symbol: string; spoken: string }) {
  return (
    <p className="inline-flex h-11 items-stretch overflow-hidden rounded-[5px] border-2 border-black bg-white text-black shadow-[0_3px_0_rgba(0,0,0,0.45)]">
      <span
        aria-hidden="true"
        className="flex w-7 items-center justify-center bg-[#003399] text-[15px] font-semibold text-white"
      >
        {symbol}
      </span>
      <span className="flex items-center px-3 text-[2rem] font-extrabold leading-none tracking-[0.01em] tabular-nums [font-family:var(--font-display)]">
        {amountFormatter.format(price)}
        <span className="sr-only"> {spoken}</span>
      </span>
    </p>
  );
}

type IconProps = { className?: string };

function PlayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.9-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SpeakerOnIcon({ className }: IconProps) {
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
      <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

function SpeakerOffIcon({ className }: IconProps) {
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
      <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" />
      <path d="m16 9 5 6" />
      <path d="m21 9-5 6" />
    </svg>
  );
}

function PinIcon({ className }: IconProps) {
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
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.25" />
    </svg>
  );
}

function PhotosIcon({ className }: IconProps) {
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
      <rect x="3.5" y="5.5" width="13" height="13" rx="2" />
      <path d="M20.5 8.5v10a2 2 0 0 1-2 2h-10" />
      <path d="m3.5 15 3.5-3.5 3 3 2-2 4.5 4.5" />
    </svg>
  );
}

function ChatIcon({ className }: IconProps) {
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
      <path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.55L3.5 20.5l1.45-4.35A8.5 8.5 0 1 1 20.5 11.5Z" />
    </svg>
  );
}