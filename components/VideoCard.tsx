"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type Hls from "hls.js";
import CommentButton from "./comments/CommentButton";
import FavoriteButton from "./FavoriteButton";
import ReportButton from "./ReportButton";
import ShareButton from "./vehicle/ShareButton";
import VehicleDetailSheet from "./VehicleDetailSheet";
import VideoPlayMark from "./brand/VideoPlayMark";
import { ACTION_BUTTON, ACTION_ICON, ACTION_ICON_BOX, ACTION_LABEL } from "./feed/actionStyles";
import SellerRow from "./social/SellerRow";
import PricePlate from "./vehicle/PricePlate";
import ViewCountBadge from "./vehicle/ViewCountBadge";
import { useSellerContact } from "./vehicle/useSellerContact";
import type { FeedVehicle } from "../lib/feed";
import { isUnlockEvent, markSoundBlocked, registerSoundTarget, useSound } from "../lib/sound";
import { setCommentCount, useCommentCount } from "../lib/use-comment-counts";
import { MOBILE_VIEW_THRESHOLD_MS, recordVehicleView } from "../lib/vehicle-views";
import { buildVehicleShareText } from "../lib/vehicle-page";

type VideoCardProps = {
  vehicle: FeedVehicle;
  /** Ekranın en az %60'ını kaplayan kart: oynatılır */
  isActive: boolean;
  /** Aktif kart ve hemen önceki/sonraki kart: HLS kaynağı bağlanır (ön yükleme) */
  shouldLoad: boolean;
};

// Kalıcı ağ/medya hatalarında sonsuz yeniden deneme döngüsüne girmemek için
const MAX_RECOVERY_ATTEMPTS = 2;

const amountFormatter = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

export default function VideoCard({ vehicle, isActive, shouldLoad }: VideoCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Ses bütün kartlarda ve masaüstü oynatıcıda ortak, kalıcı tercih (lib/sound.ts);
  // blocked: tarayıcı sesli otomatik oynatmayı reddetti, ilk dokunuş sesi açar
  const { muted, blocked: soundBlocked, setMuted } = useSound();
  const isActiveRef = useRef(isActive);
  const usingNativeHlsRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  // Video gerçekten ilerliyor (playing); duraklatma, tampon beklemesi ya da
  // kaynak bırakılınca false: izlenme bu sürenin kesintisiz olmasına bakar
  const [isRunning, setIsRunning] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const { contact: handleContact, isContacting, notice } = useSellerContact(vehicle);
  const [isDetailsOpen, setDetailsOpen] = useState(false);
  const [isReportOpen, setReportOpen] = useState(false);
  // Yorum penceresi açıkken video durmaz; sayaç pencereyle (ve masaüstü vitrin
  // penceresiyle) birlikte değişir: ortak depo (lib/use-comment-counts.ts)
  const commentsCount = useCommentCount(vehicle.id, vehicle.commentsCount);
  const handleCommentsCount = useCallback((count: number) => setCommentCount(vehicle.id, count), [vehicle.id]);

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

      // Tarayıcı sesli otomatik oynatmayı engelledi: sessiz oynat, "Sesi aç"
      // rozeti görünür; tercih (ses açık) değişmez, ilk dokunuş sesi açar
      video.muted = true;
      markSoundBlocked();
      try {
        await video.play();
      } catch {
        // Kullanıcı dokunduğunda tekrar denenecek
      }
    }
  }, []);

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

  // 2) Aktif kartsa oynat, değilse durdurup başa sar. Detay çekmecesi ya da
  // bildirim penceresi açıkken sadece duraklatılır (başa sarılmaz); kapanınca
  // kaldığı yerden sürer.
  const isOverlayOpen = isDetailsOpen || isReportOpen;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!isActive) {
      video.pause();
      video.currentTime = 0;
    } else if (isOverlayOpen) {
      video.pause();
    } else {
      void tryPlay();
    }
  }, [isActive, isOverlayOpen, tryPlay]);

  // İzlenme: ekrandaki video MOBILE_VIEW_THRESHOLD_MS kesintisiz oynayınca
  // sayılır (oturumda ilan başına bir kez; kaydırınca, duraklatınca ya da
  // tampon beklerken süre baştan başlar)
  useEffect(() => {
    if (!isActive || !isRunning) return;
    const timer = window.setTimeout(() => void recordVehicleView(vehicle.id), MOBILE_VIEW_THRESHOLD_MS);
    return () => window.clearTimeout(timer);
  }, [isActive, isRunning, vehicle.id]);

  // 3) Ortak ses durumunu bu karta uygula
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [muted]);

  // Ekrandaki kartın videosu: ses engeli kalkınca ilk dokunuşun içinde sesi açılır
  useEffect(() => {
    const video = videoRef.current;
    if (!isActive || !video) return;
    return registerSoundTarget(video);
  }, [isActive]);

  function handleTogglePlay(event: MouseEvent<HTMLButtonElement>) {
    const video = videoRef.current;
    if (!video) return;
    // Bu dokunuş sesi açtı (engel vardı): video durmasın
    if (isUnlockEvent(event.nativeEvent)) return;

    if (video.paused) void tryPlay();
    else video.pause();
  }

  function handleUnmute(event: MouseEvent<HTMLButtonElement>) {
    if (isUnlockEvent(event.nativeEvent)) return;
    const video = videoRef.current;
    if (video) {
      video.muted = false;
      if (video.paused && isActive) void tryPlay();
    }
    setMuted(false);
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
    setMuted(nextMuted);
  }

  function handleVideoError() {
    // hls.js kendi hatalarını yönetiyor; bu olay sadece yerleşik HLS yolu için
    if (usingNativeHlsRef.current && videoRef.current?.error) {
      setFailedUrl(vehicle.hlsUrl);
    }
  }

  const title = `${vehicle.brandName} ${vehicle.modelName}`;
  const showPlayHint = isActive && !isPlaying && !hasVideoError;

  return (
    <article
      aria-label={`${vehicle.year} ${title}`}
      className="relative mx-auto h-full w-full max-w-[calc(100dvh*9/16)] overflow-hidden bg-[#121212] text-white"
    >
      {/* Video çerçevesi: kartın tamamı */}
      <div className="relative h-full w-full">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          poster={vehicle.thumbnailUrl ?? undefined}
          muted={muted}
          loop
          playsInline
          preload={shouldLoad ? "auto" : "none"}
          onPlay={() => setIsPlaying(true)}
          onPause={() => {
            setIsPlaying(false);
            setIsRunning(false);
          }}
          onPlaying={() => setIsRunning(true)}
          onWaiting={() => setIsRunning(false)}
          onEmptied={() => setIsRunning(false)}
          onError={handleVideoError}
        />

        {/* Kartın tamamı: dokununca oynat / duraklat */}
        <button
          type="button"
          onClick={handleTogglePlay}
          aria-label={isPlaying ? "Videoyu duraklat" : "Videoyu oynat"}
          className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
        />

        {/* Duraklatıldığında ya da otomatik oynatma engellendiğinde görünür:
            masaüstü vitrin ve Shorts oynatıcısıyla aynı sade işaret (yarı saydam
            göz hattı, göz bebeğinde oynat üçgeni; daire, kenarlık ve buzlu zemin
            yok). Solarak ve hafifçe büyüyerek belirir, oynatınca solarak
            kaybolur. Kısa gecikme, normal oynatma başlarken simgenin yanıp
            sönmesini önler. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span
            data-paused-mark={showPlayHint ? "visible" : "hidden"}
            className={`transition-[opacity,transform] ease-out motion-reduce:scale-100 ${
              showPlayHint ? "scale-100 opacity-100 delay-150 duration-200" : "scale-90 opacity-0 duration-150"
            }`}
          >
            <VideoPlayMark className="h-20 w-20" />
          </span>
        </div>

        {hasVideoError && (
          <p className="pointer-events-none absolute inset-x-8 top-1/3 z-10 text-center text-[15px] leading-snug text-white/90">
            Bu video şu an oynatılamıyor. Sonraki ilana geçmek için kaydır.
          </p>
        )}

        {/* Tarayıcı sesli oynatmayı engelledi: video sessiz oynuyor. Ekrana ilk
            dokunuş (bu rozet dahil) sesi açar; "Filtrele" hapının sağında, üstte. */}
        {isActive && soundBlocked && (
          <button
            type="button"
            onClick={handleUnmute}
            data-unmute-pill=""
            className="absolute top-[calc(env(safe-area-inset-top)+3.9rem)] left-1/2 z-30 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/55 pr-3 pl-2.5 text-[13px] font-semibold text-white ring-1 ring-inset ring-white/20 backdrop-blur-[6px] motion-safe:animate-[fade-in_200ms_ease-out] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <SpeakerOffIcon className="h-4 w-4" />
            Sesi aç
          </button>
        )}

        {/* Videonun alt şeridinde hafif gölge; yazılar onun üstünde okunur */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[15] h-[24%] min-h-36 bg-[linear-gradient(to_top,rgba(0,0,0,0.62)_0%,rgba(0,0,0,0.3)_55%,rgba(0,0,0,0)_100%)]"
        />

        {/* Bilgi katmanı: metne yapılan dokunuşlar alttaki oynat/duraklat
            butonuna geçer, sadece bu katmandaki butonlar tıklanabilir.
            Yalnızca alt şerit: satıcı etiketi, tek satır başlık, fiyat ve
            Yıl / KM / İl hapları; videonun ortası boş kalır. Ekranın altındaki
            güvenli alanı alt gezinme çubuğu karşılar. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 pr-1.5 pb-3 pl-3 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 pb-0.5">
              <SellerRow
                sellerId={vehicle.sellerId}
                badge={<ViewCountBadge vehicleId={vehicle.id} count={vehicle.viewsCount ?? 0} />}
              />

              <h2 className="text-[20px] font-semibold leading-6 [font-family:var(--font-display)] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                <button
                  type="button"
                  onClick={() => setDetailsOpen(true)}
                  aria-haspopup="dialog"
                  className="pointer-events-auto block max-w-full truncate rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {title}
                </button>
              </h2>

              {/* Fiyat ve haplara dokunmak da detayları açar (klavye/ekran
                  okuyucu için başlık ve "Detaylar" düğmesi var) */}
              <ul
                aria-label="Fiyat ve araç özellikleri"
                onClick={() => setDetailsOpen(true)}
                className="pointer-events-auto mt-1.5 flex cursor-pointer flex-wrap items-center gap-1"
              >
                <li className="mr-0.5">
                  <PricePlate price={vehicle.price} currency={vehicle.currency} size="sm" />
                </li>
                <Tag>{vehicle.year}</Tag>
                <Tag>{amountFormatter.format(vehicle.mileageKm)} km</Tag>
                {vehicle.city && <Tag icon={<PinIcon className="h-3 w-3 shrink-0" />}>{vehicle.city}</Tag>}
                {vehicle.hasHeavyDamage && <Tag tone="danger">Ağır hasar</Tag>}
                {vehicle.isTest && <Tag>Test ilanı</Tag>}
              </ul>

              <div role="status" aria-live="polite">
                {notice && (
                  <p className="mt-2 max-w-[20rem] rounded-md bg-black/75 px-3 py-2 text-[13px] leading-snug">
                    {notice}
                  </p>
                )}
              </div>
            </div>

            {/* TikTok / Reels gibi arka plansız 26 px simgeler (feed/actionStyles.ts);
                kısa ekranda (320×568) aralık daralır, sütun başlığa değmez */}
            <div className="flex shrink-0 flex-col items-center gap-2.5 [@media(max-height:620px)]:gap-1">
              <FavoriteButton vehicleId={vehicle.id} variant="overlay" />

              <CommentButton vehicleId={vehicle.id} count={commentsCount} onCountChange={handleCommentsCount} />

              <ShareButton
                vehicle={vehicle}
                title={title}
                text={buildVehicleShareText(vehicle)}
                variant="overlay"
              />

              <button
                type="button"
                onClick={handleContact}
                disabled={isContacting}
                aria-busy={isContacting}
                aria-label="WhatsApp'tan yaz"
                className={`${ACTION_BUTTON} disabled:opacity-70`}
              >
                <span className="flex h-10 w-11 items-center justify-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#25D366] text-[#062612] shadow-[0_1px_4px_rgba(0,0,0,0.35)] motion-safe:transition-transform motion-safe:group-active:scale-90">
                    <ChatIcon className="h-6 w-6" />
                  </span>
                </span>
                <span aria-hidden="true" className={ACTION_LABEL}>
                  {isContacting ? "Açılıyor" : "WhatsApp"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                aria-haspopup="dialog"
                aria-label="İlan detayları ve fotoğraflar"
                className={`${ACTION_BUTTON}`}
              >
                <span className={ACTION_ICON_BOX}>
                  <PhotosIcon className={ACTION_ICON} />
                </span>
                <span aria-hidden="true" className={ACTION_LABEL}>
                  Detaylar
                </span>
              </button>

              <ReportButton vehicleId={vehicle.id} variant="overlay" onOpenChange={setReportOpen} />

              <button
                type="button"
                onClick={handleToggleMute}
                aria-label={muted ? "Sesi aç" : "Sesi kapat"}
                className="group pointer-events-auto flex h-10 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {muted ? (
                  <SpeakerOffIcon className="h-6 w-6 drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]" />
                ) : (
                  <SpeakerOnIcon className="h-6 w-6 drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]" />
                )}
              </button>
            </div>
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

// Yıl / km / şehir hapları: küçük, yarı saydam ve ince kenarlıklı; videonun
// üstünde de okunur. Ağır hasar kırmızı hapta.
function Tag({ icon, tone = "default", children }: { icon?: ReactNode; tone?: "default" | "danger"; children: ReactNode }) {
  return (
    <li
      className={`inline-flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[11.5px] font-medium leading-none text-white ring-1 ring-inset ${
        tone === "danger" ? "bg-[#E5484D] ring-transparent" : "bg-black/30 ring-white/15 backdrop-blur-[6px]"
      }`}
    >
      {icon}
      {children}
    </li>
  );
}

type IconProps = { className?: string };

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