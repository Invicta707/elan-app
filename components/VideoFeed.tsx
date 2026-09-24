"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import VideoCard from "./VideoCard";
import { fetchFeedPage, fetchFeedVehicle, type FeedCursor, type FeedVehicle } from "../lib/feed";

const PAGE_SIZE = 8;
// Sona bu kadar kart kala sıradaki sayfa istenir
const PREFETCH_DISTANCE = 3;
// Aktif kartın ±2 komşusu video elementiyle DOM'da tutulur, uzaktakiler boş kalır
const RENDER_WINDOW = 2;
// Bir kartın aktif sayılması için görünmesi gereken oran
const ACTIVE_RATIO = 0.6;

const PINNED_MISSING_NOTICE =
  "Açmak istediğin video artık yayında değil. Akıştaki diğer ilanları gösteriyoruz.";

// Akış sayfası ve (varsa) arama sayfasından seçilen ilan paralel istenir.
// Seçilen ilan bulunamazsa akış normal şekilde devam eder.
async function fetchFeedBatch(cursor: FeedCursor | null, pinnedId: string | null) {
  const [page, pinned] = await Promise.all([
    fetchFeedPage(cursor, PAGE_SIZE),
    pinnedId ? fetchFeedVehicle(pinnedId).catch(() => null) : Promise.resolve(null),
  ]);
  return { page, pinned };
}

type VideoFeedProps = {
  /** Arama sayfasından gelindiyse (/?v=<id>) akışın ilk sırada göstereceği ilan */
  initialVehicleId?: string | null;
};

export default function VideoFeed({ initialVehicleId = null }: VideoFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const cursorRef = useRef<FeedCursor | null>(null);
  const isFetchingRef = useRef(false);
  // İlk başarılı yüklemede bir kez kullanılır
  const pinnedIdRef = useRef<string | null>(initialVehicleId);

  const [vehicles, setVehicles] = useState<FeedVehicle[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pagesLoaded, setPagesLoaded] = useState(0);
  const [muted, setMuted] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const loadNextPage = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const pinnedId = pinnedIdRef.current;
      const { page, pinned } = await fetchFeedBatch(cursorRef.current, pinnedId);

      // Aranan ilan artık yayında değilse kısa bir bilgi göster. (if bloğuna alınmadı:
      // react-hooks lint kuralı iç bloktaki setState'i senkron sayıp hata veriyor.)
      const pinnedMissing = pinnedId !== null && pinned === null;
      pinnedIdRef.current = null;
      setNotice((current) => (pinnedMissing ? PINNED_MISSING_NOTICE : current));

      cursorRef.current = page.nextCursor;
      setVehicles((current) => {
        // Seçilen ilan başa; akışta sonradan tekrar gelirse atlanır
        const seen = new Set(current.map((v) => v.id));
        const next = [...current];
        for (const vehicle of pinned ? [pinned, ...page.items] : page.items) {
          if (seen.has(vehicle.id)) continue;
          seen.add(vehicle.id);
          next.push(vehicle);
        }
        return next;
      });
      setHasMore(page.hasMore);
      setPagesLoaded((count) => count + 1);
    } catch (error) {
      console.error("Feed yüklenemedi:", error);
      setLoadFailed(true);
    } finally {
      isFetchingRef.current = false;
    }
  }, []);

  // Aktif kartı tek bir IntersectionObserver belirler: aynı anda yalnızca bir video oynar
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= ACTIVE_RATIO) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (!Number.isNaN(index)) setActiveIndex(index);
          }
        }
      },
      { root, threshold: ACTIVE_RATIO },
    );
    observerRef.current = observer;

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  // Yeni sayfa geldikçe yeni kartları da gözlemle
  // (zaten gözlenen bir eleman için observe() etkisizdir)
  useEffect(() => {
    const root = containerRef.current;
    const observer = observerRef.current;
    if (!root || !observer) return;

    root.querySelectorAll<HTMLElement>("[data-index]").forEach((el) => observer.observe(el));
  }, [vehicles.length, hasMore, loadFailed]);

  // Sonsuz kaydırma: sona yaklaşınca sıradaki sayfayı getir.
  // pagesLoaded, yeni kart getirmeyen bir sayfadan sonra da tetiklenmeyi garanti eder.
  useEffect(() => {
    if (loadFailed || !hasMore) return;
    if (activeIndex >= vehicles.length - PREFETCH_DISTANCE) void loadNextPage();
  }, [activeIndex, vehicles.length, hasMore, loadFailed, pagesLoaded, loadNextPage]);

  // Bilgi mesajını birkaç saniye sonra kaldır
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function handleRetry() {
    // loadFailed false olunca yukarıdaki efekt tekrar çalışıp sayfayı ister
    setLoadFailed(false);
  }

  function handleBackToTop() {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    containerRef.current?.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }

  // Son eleman sadece hata ve "hepsi bu kadar" durumlarında tam ekran bir durak
  // (snap noktası) olur. Yeni sayfa yüklenirken ise kısa, durulamayan bir şerittir:
  // tarayıcılar içerik değişince son durulan elemana geri hizalandığı için, yükleme
  // şeridi bir durak olsaydı yeni kartlar gelse de kullanıcı şeritte kalırdı.
  const tailIsStop = loadFailed || !hasMore;
  const tailIsFullScreen = tailIsStop || vehicles.length === 0;

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain bg-black [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {vehicles.map((vehicle, index) => {
          const distance = Math.abs(index - activeIndex);
          return (
            <div
              key={vehicle.id}
              data-index={index}
              className="h-full w-full snap-start snap-always"
            >
              {distance <= RENDER_WINDOW && (
                <VideoCard
                  vehicle={vehicle}
                  isActive={index === activeIndex}
                  shouldLoad={distance <= 1}
                  muted={muted}
                  onMutedChange={setMuted}
                />
              )}
            </div>
          );
        })}

        {/* Durak olduğunda data-index alır: kullanıcı buraya gelince hiçbir video aktif kalmaz */}
        <div
          data-index={tailIsStop ? vehicles.length : undefined}
          aria-live="polite"
          className={`flex w-full flex-col items-center justify-center gap-5 px-10 text-center ${
            tailIsFullScreen ? "h-full" : "h-28"
          } ${tailIsStop ? "snap-start snap-always" : ""}`}
        >
          <FeedTail
            loadFailed={loadFailed}
            hasMore={hasMore}
            isEmpty={vehicles.length === 0}
            onRetry={handleRetry}
            onBackToTop={handleBackToTop}
          />
        </div>
      </div>

      {/* Kaydırma alanının dışında: içerikle birlikte kaymaz */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute inset-x-4 top-[calc(env(safe-area-inset-top)+4.5rem)] z-40 flex justify-center"
      >
        {notice && (
          <p className="max-w-sm rounded-md bg-black/80 px-4 py-3 text-center text-[14px] leading-snug text-white">
            {notice}
          </p>
        )}
      </div>
    </div>
  );
}

const plateButtonClass =
  "rounded-[5px] border-2 border-black bg-white px-5 py-2.5 text-base font-semibold text-black shadow-[0_3px_0_rgba(0,0,0,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black";

function FeedTail({
  loadFailed,
  hasMore,
  isEmpty,
  onRetry,
  onBackToTop,
}: {
  loadFailed: boolean;
  hasMore: boolean;
  isEmpty: boolean;
  onRetry: () => void;
  onBackToTop: () => void;
}) {
  if (loadFailed) {
    return (
      <>
        <div>
          <p className="text-lg font-semibold">İlanlar yüklenemedi.</p>
          <p className="mt-1 text-[15px] text-white/75">
            İnternet bağlantını kontrol edip tekrar dene.
          </p>
        </div>
        <button type="button" onClick={onRetry} className={plateButtonClass}>
          Tekrar dene
        </button>
      </>
    );
  }

  if (hasMore) {
    return (
      <>
        <span
          aria-hidden="true"
          className="h-8 w-8 rounded-full border-2 border-white/25 border-t-white motion-safe:animate-spin"
        />
        <p className="text-[15px] text-white/75">İlanlar yükleniyor</p>
      </>
    );
  }

  if (isEmpty) {
    return (
      <div>
        <p className="text-lg font-semibold">Yayında ilan yok.</p>
        <p className="mt-1 text-[15px] text-white/75">
          Satıcılar videolu ilan ekledikçe burada göreceksin.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="text-lg font-semibold">Tüm ilanları gördün.</p>
      <button type="button" onClick={onBackToTop} className={plateButtonClass}>
        Başa dön
      </button>
    </>
  );
}