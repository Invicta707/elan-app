"use client";

import type Hls from "hls.js";
import { Check, EyeOff, VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Seri incelemede videonun tamamı, uygulamanın içinde (TWA'da yeni sekme açmadan).
// Yerleşik kontroller bilinçli: yönetici videoda ileri geri gidebilmeli; otomatik
// denetim yalnızca örnek karelere baktığı için onaydan önce videonun tamamı izlenmeli.
// İlan değişince bileşen yeniden kurulur (key), durum sıfırlanır.

export default function ReviewVideo({
  hlsUrl,
  posterUrl,
  sensitive,
  watchUrl,
}: {
  hlsUrl: string | null;
  posterUrl: string | null;
  /** Şüpheli içerik: kapak bulanık, video dokununca başlar */
  sensitive: boolean;
  /** Oynatılamazsa yedek: Cloudflare izleme sayfası */
  watchUrl: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(!hlsUrl);
  const [revealed, setRevealed] = useState(!sensitive);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;
    let hls: Hls | null = null;
    let cancelled = false;

    void (async () => {
      const { default: HlsClass } = await import("hls.js");
      if (cancelled) return;
      if (HlsClass.isSupported()) {
        const instance = new HlsClass({ capLevelToPlayerSize: true });
        hls = instance;
        instance.on(HlsClass.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          // Silinmiş video: manifest 404. Kurtarma denemesi anlamsız
          instance.destroy();
          hls = null;
          setFailed(true);
        });
        instance.loadSource(hlsUrl);
        instance.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = hlsUrl;
      } else {
        setFailed(true);
        return;
      }
      // Sessiz başlar (tarayıcı sesli otomatik oynatmaya izin vermez); ses kontrollerden açılır
      if (!sensitive) video.play().catch(() => {});
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [hlsUrl, sensitive]);

  function reveal() {
    setRevealed(true);
    void videoRef.current?.play().catch(() => {});
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        poster={posterUrl ?? undefined}
        controls={revealed && !failed}
        muted
        playsInline
        preload="auto"
        onPlay={() => setEnded(false)}
        onEnded={() => setEnded(true)}
        onError={() => {
          // hls.js kendi hatalarını bildirir; bu yol yerleşik HLS (iOS Safari) için
          if (videoRef.current?.error && !videoRef.current.src.startsWith("blob:")) setFailed(true);
        }}
      />

      {!revealed && !failed && (
        <button
          type="button"
          onClick={reveal}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 px-6 text-center text-white backdrop-blur-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
        >
          <EyeOff aria-hidden="true" className="h-8 w-8" />
          <span className="text-[15px] font-semibold">Hassas içerik olabilir</span>
          <span className="text-[13px] text-white/75">Videoyu açmak için dokun</span>
        </button>
      )}

      {failed && (
        <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white">
          <VideoOff aria-hidden="true" className="h-8 w-8 text-white/70" />
          <p className="text-[15px] font-semibold">Video oynatılamadı</p>
          <p className="max-w-xs text-[13px] leading-snug text-white/70">
            {hlsUrl
              ? "Video Cloudflare'de silinmiş olabilir. Videosu olmayan ilan yayına alınamaz; reddedebilirsin."
              : "Bu ilanın işlenmiş videosu yok."}
          </p>
          {watchUrl && hlsUrl && (
            <a
              href={watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 rounded-sm text-[13px] font-semibold text-white underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Cloudflare&apos;de dene ↗
            </a>
          )}
        </div>
      )}

      {ended && !failed && (
        <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[12px] font-semibold text-white">
          <Check aria-hidden="true" className="h-3.5 w-3.5" />
          Sonuna kadar izlendi
        </span>
      )}
    </div>
  );
}
