"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import VideoCard from "./VideoCard";
import { useSupabaseSession } from "../lib/auth";
import { fetchFeedPage, fetchFeedVehicle, type FeedCursor, type FeedSource, type FeedVehicle } from "../lib/feed";
import { clampFeedIndex, feedKeyStepFor } from "../lib/feed-navigation";
import { fetchFilteredFeedPage } from "../lib/portal";
import type { SearchFilters } from "../lib/search";
import { primeSellerProfiles } from "../lib/use-follow";

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
async function fetchFeedBatch<P>(fetchPage: () => Promise<P>, pinnedId: string | null) {
  const [page, pinned] = await Promise.all([
    fetchPage(),
    pinnedId ? fetchFeedVehicle(pinnedId).catch(() => null) : Promise.resolve(null),
  ]);
  return { page, pinned };
}

type VideoFeedProps = {
  /** "Videoyu akışta izle" bağlantısından gelindiyse (/?v=<id>) akışın ilk sırada göstereceği ilan */
  initialVehicleId?: string | null;
  /** "explore": bütün yayındaki ilanlar; "following": takip edilen satıcılarınki */
  source?: FeedSource;
  /**
   * Ana sayfada filtre uygulandıysa (hap düğmesi, /?marka=…): akış bu
   * filtreye uyan videolu ilanlardan kurulur. Filtre değişince akış yeniden
   * kurulur (key); bileşen ilk değeri kullanır.
   */
  filters?: SearchFilters | null;
  /**
   * Akış ekranda mı: sekme değişince gizlenen akış silinmez (yeri korunur) ama
   * hiçbir videosu oynamaz ve yalnızca aktif kartın videosu bağlı kalır
   */
  visible?: boolean;
  /** Hiç ilan yoksa gösterilecek içerik (varsayılan: "Yayında ilan yok.") */
  emptyState?: ReactNode;
};

/** Programla başlatılan kaydırmanın hedefi bu süreden sonra bırakılır (kullanıcı araya girdiyse) */
const PENDING_TARGET_MS = 900;

export default function VideoFeed({
  initialVehicleId = null,
  source = "explore",
  filters = null,
  visible = true,
  emptyState,
}: VideoFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const cursorRef = useRef<FeedCursor | null>(null);
  // Filtreli akış: arama offset'le sayfalanır
  const offsetRef = useRef(0);
  const filtersRef = useRef(filters);
  const isFetchingRef = useRef(false);
  // İlk başarılı yüklemede bir kez kullanılır
  const pinnedIdRef = useRef<string | null>(initialVehicleId);

  const [vehicles, setVehicles] = useState<FeedVehicle[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  // Klavye gezinmesi: son aktif kart ve (kaydırma sürerken) gidilen kart
  const activeIndexRef = useRef(0);
  const pendingTargetRef = useRef<{ index: number; at: number } | null>(null);
  const lastIndexRef = useRef(-1);
  const [hasMore, setHasMore] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pagesLoaded, setPagesLoaded] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const { session } = useSupabaseSession();
  const viewerId = session?.user.id ?? null;

  const loadNextPage = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const pinnedId = pinnedIdRef.current;
      const activeFilters = filtersRef.current;
      let items: FeedVehicle[];
      let more: boolean;
      let pinned: FeedVehicle | null;
      if (activeFilters) {
        const batch = await fetchFeedBatch(() => fetchFilteredFeedPage(activeFilters, offsetRef.current, PAGE_SIZE), pinnedId);
        offsetRef.current = batch.page.nextOffset;
        ({ items, hasMore: more } = batch.page);
        pinned = batch.pinned;
      } else {
        const batch = await fetchFeedBatch(() => fetchFeedPage(cursorRef.current, PAGE_SIZE, source), pinnedId);
        cursorRef.current = batch.page.nextCursor;
        ({ items, hasMore: more } = batch.page);
        pinned = batch.pinned;
      }

      // Aranan ilan artık yayında değilse kısa bir bilgi göster. (if bloğuna alınmadı:
      // react-hooks lint kuralı iç bloktaki setState'i senkron sayıp hata veriyor.)
      const pinnedMissing = pinnedId !== null && pinned === null;
      pinnedIdRef.current = null;
      setNotice((current) => (pinnedMissing ? PINNED_MISSING_NOTICE : current));

      setVehicles((current) => {
        // Seçilen ilan başa; akışta sonradan tekrar gelirse atlanır
        const seen = new Set(current.map((v) => v.id));
        const next = [...current];
        for (const vehicle of pinned ? [pinned, ...items] : items) {
          if (seen.has(vehicle.id)) continue;
          seen.add(vehicle.id);
          next.push(vehicle);
        }
        return next;
      });
      setHasMore(more);
      setPagesLoaded((count) => count + 1);
    } catch (error) {
      console.error("Feed yüklenemedi:", error);
      setLoadFailed(true);
    } finally {
      isFetchingRef.current = false;
    }
  }, [source]);

  // Kartlardaki satıcı satırı (ad, avatar, takip): yeni gelen satıcılar tek
  // istekte istenir; oturum değişince (giriş/çıkış) takip durumu yeniden okunur
  useEffect(() => {
    void primeSellerProfiles(vehicles.map((v) => v.sellerId));
  }, [vehicles, viewerId]);

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

  useEffect(() => {
    activeIndexRef.current = activeIndex;
    if (pendingTargetRef.current?.index === activeIndex) pendingTargetRef.current = null;
  }, [activeIndex]);

  /** Karta git (klavye): sınırda durur; art arda basışlar hedeften sayılır */
  const goToStep = useCallback((step: -1 | 1) => {
    const container = containerRef.current;
    if (!container) return;
    const pending = pendingTargetRef.current;
    const base = pending && performance.now() - pending.at < PENDING_TARGET_MS ? pending.index : activeIndexRef.current;
    const target = clampFeedIndex(base + step, lastIndexRef.current);
    if (target === base) return;
    pendingTargetRef.current = { index: target, at: performance.now() };
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.scrollTo({ top: target * container.clientHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, []);

  // Klavye (klavyeli tablet, dar masaüstü penceresi): ↑/↓ ve PageUp/PageDown
  // bir ilan (yazı alanında ve açık pencerede değil). Görünmeyen akış dinlemez.
  useEffect(() => {
    if (!visible) return;
    function onKeyDown(event: KeyboardEvent) {
      // Açık pencere (yorumlar, detaylar, giriş) ya da tam ekran fotoğraf: tuşlar onundur
      const dialogOpen = Boolean(document.querySelector("dialog[open], [role='dialog'][aria-modal='true']"));
      const step = feedKeyStepFor(event, dialogOpen);
      if (!step) return;
      event.preventDefault();
      goToStep(step);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, goToStep]);

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
  // Klavyeyle gidilebilecek son kart: akış sonu bir duraksa o
  useEffect(() => {
    lastIndexRef.current = tailIsStop ? vehicles.length : vehicles.length - 1;
  }, [tailIsStop, vehicles.length]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain bg-[#121212] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                  isActive={visible && index === activeIndex}
                  shouldLoad={visible ? distance <= 1 : distance === 0}
                />
              )}
            </div>
          );
        })}

        {/* Durak olduğunda data-index alır: kullanıcı buraya gelince hiçbir video aktif kalmaz */}
        <div
          data-index={tailIsStop ? vehicles.length : undefined}
          aria-live="polite"
          // Özel boş durum (kart) üstteki başlık ve sekmelerin altından başlar
          className={`flex w-full flex-col items-center justify-center gap-5 text-center ${
            tailIsFullScreen ? "h-full" : "h-28"
          } ${tailIsStop ? "snap-start snap-always" : ""} ${
            emptyState && vehicles.length === 0 && tailIsStop
              ? "px-5 pt-[calc(env(safe-area-inset-top)+4.5rem)] pb-5"
              : "px-10"
          }`}
        >
          <FeedTail
            loadFailed={loadFailed}
            hasMore={hasMore}
            isEmpty={vehicles.length === 0}
            emptyState={emptyState}
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
  emptyState,
  onRetry,
  onBackToTop,
}: {
  loadFailed: boolean;
  hasMore: boolean;
  isEmpty: boolean;
  emptyState?: ReactNode;
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

  if (isEmpty && emptyState) return emptyState;

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