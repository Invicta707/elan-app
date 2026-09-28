"use client";

import { Volume2, VolumeX } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PortalVehicle } from "../../lib/portal";
import { useHlsVideo } from "../../lib/use-hls-video";
import EyePlayMark from "../brand/EyePlayMark";

// Vitrin penceresinin solundaki büyük 9:16 oynatıcı. İlan değişince yeniden
// kurulur (key): önceki videonun kaynağı bırakılır. Pencere bir tıklamayla
// açıldığı için sesli başlamayı dener; tarayıcı engellerse sessize alıp oynatır.

const timeFormatter = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

export default function PortalPlayer({
  vehicle,
  muted,
  onMutedChange,
}: {
  vehicle: PortalVehicle;
  /** Ses durumu pencerede ilandan ilana taşınır */
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({ current: 0, duration: 0 });
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

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

  const { failed } = useHlsVideo(videoRef, vehicle.hlsUrl, { onAttached: (video) => void tryPlay(video) });

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void tryPlay(video);
    else video.pause();
  }

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
      <div className="relative h-full w-full bg-black">
        {vehicle.posterUrl && <Image src={vehicle.posterUrl} alt="" fill sizes="480px" className="object-contain" />}
        <p className="absolute inset-x-6 bottom-6 rounded-lg bg-black/70 px-3 py-2 text-center text-[14px] text-white/90">
          Bu ilanın videosu yok.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-black">
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
        onLoadedMetadata={(event) => setTime({ current: 0, duration: event.currentTarget.duration || 0 })}
        onTimeUpdate={(event) =>
          setTime({ current: event.currentTarget.currentTime, duration: event.currentTarget.duration || 0 })
        }
      />

      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? "Videoyu duraklat" : "Videoyu oynat"}
        className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
      />

      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <span
          className={`flex h-[84px] w-[84px] items-center justify-center rounded-full bg-black/35 ring-1 ring-inset ring-white/15 backdrop-blur-[6px] transition-[opacity,transform] ease-out motion-reduce:scale-100 ${
            !playing && !failed ? "scale-100 opacity-100 delay-150 duration-200" : "scale-90 opacity-0 duration-150"
          }`}
        >
          <EyePlayMark className="h-12 w-12 text-white" strokeWidth={4} />
        </span>
      </div>

      {failed && (
        <p role="status" className="pointer-events-none absolute inset-x-8 top-1/3 z-10 text-center text-[15px] leading-snug text-white/90">
          Bu video şu an oynatılamıyor.
        </p>
      )}

      {/* Alt şerit: ilerleme (sürüklenebilir), süre, ses */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 bg-[linear-gradient(to_top,rgba(0,0,0,0.55),rgba(0,0,0,0))] px-3 pt-8 pb-3">
        <input
          type="range"
          min={0}
          max={time.duration || 0}
          step={0.1}
          value={Math.min(time.current, time.duration || 0)}
          disabled={!time.duration}
          aria-label="Videoda konum"
          aria-valuetext={`${timeFormatter(time.current)} / ${timeFormatter(time.duration)}`}
          onChange={(event) => {
            const video = videoRef.current;
            if (video) video.currentTime = Number(event.target.value);
          }}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-white disabled:cursor-default"
        />
        <span aria-hidden="true" className="shrink-0 text-[12px] font-medium tabular-nums text-white/85">
          {timeFormatter(time.current)} / {timeFormatter(time.duration)}
        </span>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Sesi aç" : "Sesi kapat"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {muted ? <VolumeX aria-hidden="true" className="h-5 w-5" /> : <Volume2 aria-hidden="true" className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}
