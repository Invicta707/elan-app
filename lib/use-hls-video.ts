"use client";

import type Hls from "hls.js";
import { useEffect, useRef, useState, type RefObject } from "react";

// Cloudflare Stream HLS kaynağını bir <video>'ya bağlar (vitrin kartındaki
// önizleme ve penceredeki oynatıcı). hls.js ihtiyaç anında yüklenir; Media
// Source olmayan Safari yerleşik HLS'i kullanır. Kaynak bırakılınca (url
// değişir, enabled false olur ya da bileşen kalkar) hls.js örneği yok edilir,
// src kaldırılıp load() çağrılır: indirilen parçalar ve çözücü belleği boşalır.

// Kalıcı ağ/medya hatalarında sonsuz yeniden deneme döngüsüne girmemek için
const MAX_RECOVERY_ATTEMPTS = 2;

type Options = {
  /** false: kaynak bağlanmaz (bağlıysa bırakılır) */
  enabled?: boolean;
  /** İleriye doğru indirilecek en fazla saniye (önizlemede kısa tutulur) */
  maxBufferLength?: number;
  /** Kaynak bağlandı: oynatma burada başlatılır */
  onAttached?: (video: HTMLVideoElement) => void;
};

export function useHlsVideo(
  videoRef: RefObject<HTMLVideoElement | null>,
  url: string | null,
  { enabled = true, maxBufferLength = 10, onAttached }: Options = {},
): { failed: boolean } {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const onAttachedRef = useRef(onAttached);
  useEffect(() => {
    onAttachedRef.current = onAttached;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || !enabled) return;

    let hls: Hls | null = null;
    let cancelled = false;
    let recoveryAttempts = 0;

    void (async () => {
      const { default: HlsClass } = await import("hls.js");
      if (cancelled) return;

      if (HlsClass.isSupported()) {
        const instance = new HlsClass({ capLevelToPlayerSize: true, maxBufferLength });
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
        video.src = url;
      } else {
        setFailedUrl(url);
        return;
      }

      onAttachedRef.current?.(video);
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [videoRef, url, enabled, maxBufferLength]);

  return { failed: url !== null && failedUrl === url };
}
