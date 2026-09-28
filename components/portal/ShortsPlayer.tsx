"use client";

import { Volume2, VolumeX } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { PortalVehicle } from "../../lib/portal";
import { useHlsVideo } from "../../lib/use-hls-video";
import { recordVehicleView } from "../../lib/vehicle-views";
import VideoPlayMark from "../brand/VideoPlayMark";

// Shorts oynatıcısının 9:16 videosu: çerçevenin tamamı. İlan değişince
// yeniden kurulur (ShortsViewer'da key): önceki videonun kaynağı bırakılır.
// Oynatıcı bir tıklamayla açıldığı için sesli başlamayı dener; tarayıcı
// engellerse sessize alıp oynatır. Videoya tıklamak durdurur/oynatır;
// duraklatınca ortada yarı saydam göz-oynat işareti belirir. Sağ üstte ses,
// en altta ince, sürüklenebilir ilerleme çubuğu. Video oynamaya başlayınca
// izlenme sayılır (oturumda ilan başına bir kez, lib/vehicle-views.ts).

/** Boşluk tuşu (ShortsViewer) oynatmayı buradan değiştirir */
export type ShortsPlayerControl = { togglePlay: () => void };

const timeText = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

export default function ShortsPlayer({
  vehicle,
  muted,
  onMutedChange,
  controlRef,
}: {
  vehicle: PortalVehicle;
  /** Ses durumu oynatıcıda ilandan ilana taşınır */
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  controlRef?: RefObject<ShortsPlayerControl | null>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({ current: 0, duration: 0 });
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  // Kullanıcı durdurmadıkça video oynamalı: ilk play() yükleme sırasında
  // kesilirse (AbortError) ya da tarayıcı yüklemeyi erteledi ise oynatılabilir
  // olunca (canplay) yeniden denenir
  const userPausedRef = useRef(false);

  const tryPlay = useCallback(
    async (video: HTMLVideoElement) => {
      video.muted = mutedRef.current;
      try {
        await video.play();
      } catch (error) {
        // AbortError: oynatma bir duraklatma ya da kaynak değişimiyle kesildi
        if (!(error instanceof DOMException) || error.name !== "NotAllowedError" || video.muted) return;
        video.muted = true;
        onMutedChange(true);
        await video.play().catch(() => {});
      }
    },
    [onMutedChange],
  );

  // Büyük çerçeve: hls.js çerçeveye (ve ekranın piksel yoğunluğuna) uyan en
  // yüksek kaliteyi seçer; akıcı geçiş için biraz daha uzun tampon
  const { failed } = useHlsVideo(videoRef, vehicle.hlsUrl, { maxBufferLength: 20, onAttached: (video) => void tryPlay(video) });

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    userPausedRef.current = !video.paused;
    if (video.paused) void tryPlay(video);
    else video.pause();
  }, [tryPlay]);

  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = { togglePlay };
    return () => {
      controlRef.current = null;
    };
  }, [controlRef, togglePlay]);

  function toggleMute() {
    const next = !muted;
    const video = videoRef.current;
    if (video) {
      video.muted = next;
      if (!next && video.paused) void tryPlay(video);
    }
    onMutedChange(next);
  }

  const title = `${vehicle.year} ${vehicle.brandName} ${vehicle.modelName}`;

  if (!vehicle.hlsUrl) {
    return (
      <div className="absolute inset-0 bg-black">
        {vehicle.posterUrl && <Image src={vehicle.posterUrl} alt="" fill sizes="600px" className="object-contain" />}
        <p className="absolute inset-x-6 top-1/3 rounded-lg bg-black/70 px-3 py-2 text-center text-[14px] text-white/90">
          Bu ilanın videosu yok. Fotoğraflar “İlan detayı”nda.
        </p>
      </div>
    );
  }

  const paused = !playing && !failed;

  return (
    <div className="absolute inset-0 bg-black">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        poster={vehicle.posterUrl ?? undefined}
        muted={muted}
        loop
        playsInline
        preload="auto"
        aria-label={`${title} videosu`}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onPlaying={() => void recordVehicleView(vehicle.id)}
        onCanPlay={(event) => {
          if (event.currentTarget.paused && !userPausedRef.current) void tryPlay(event.currentTarget);
        }}
        onLoadedMetadata={(event) => setTime({ current: 0, duration: event.currentTarget.duration || 0 })}
        onTimeUpdate={(event) =>
          setTime({ current: event.currentTarget.currentTime, duration: event.currentTarget.duration || 0 })
        }
      />

      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? "Videoyu duraklat" : "Videoyu oynat"}
        title={playing ? "Duraklat (boşluk)" : "Oynat (boşluk)"}
        className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
      />

      {/* Duraklatınca: yalnızca yarı saydam göz hattı ve oynat üçgeni (daire yok).
          Kısa gecikme, oynatma başlarken işaretin yanıp sönmesini önler. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <span
          data-paused-mark={paused ? "visible" : "hidden"}
          className={`transition-[opacity,transform] ease-out motion-reduce:scale-100 ${
            paused ? "scale-100 opacity-100 delay-150 duration-200" : "scale-90 opacity-0 duration-150"
          }`}
        >
          <VideoPlayMark className="h-20 w-20" />
        </span>
      </div>

      {failed && (
        <p role="status" className="pointer-events-none absolute inset-x-8 top-1/3 z-10 text-center text-[15px] leading-snug text-white/90">
          Bu video şu an oynatılamıyor.
        </p>
      )}

      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Sesi aç" : "Sesi kapat"}
        title={muted ? "Sesi aç" : "Sesi kapat"}
        className="absolute top-3 right-3 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-[6px] transition-colors hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        {muted ? <VolumeX aria-hidden="true" className="h-5 w-5" /> : <Volume2 aria-hidden="true" className="h-5 w-5" />}
      </button>

      {/* İnce ilerleme çubuğu: çerçevenin en altında, fareyle ya da klavye odağıyla
          kalınlaşır. Görünen çizgi süs; tıklama, sürükleme ve ←/→ üstteki saydam
          kaydırıcıda (erişilebilir ad ve süre metniyle). */}
      <div className="group/progress absolute inset-x-0 bottom-0 z-30 flex h-4 items-end">
        <div
          aria-hidden="true"
          className="h-[3px] w-full bg-white/25 transition-[height] group-hover/progress:h-[5px] group-has-[:focus-visible]/progress:h-[5px]"
        >
          <div
            data-progress=""
            className="h-full bg-white"
            style={{ width: `${time.duration ? Math.min(100, (time.current / time.duration) * 100) : 0}%` }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={time.duration || 0}
          step={0.1}
          value={Math.min(time.current, time.duration || 0)}
          disabled={!time.duration}
          aria-label="Videoda konum"
          aria-valuetext={`${timeText(time.current)} / ${timeText(time.duration)}`}
          onChange={(event) => {
            const video = videoRef.current;
            if (video) video.currentTime = Number(event.target.value);
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        />
      </div>
    </div>
  );
}
