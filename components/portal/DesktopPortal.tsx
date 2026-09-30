"use client";

import { Heart, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import AuthGatedLink, { AuthModalPortal } from "../AuthGatedLink";
import HeaderProfileButton from "../HeaderProfileButton";
import Logo from "../Logo";
import FeedTabs, { type FeedTab } from "../social/FeedTabs";
import FollowingEmpty from "../social/FollowingEmpty";
import FilterConsole from "./FilterConsole";
import PortalCard from "./PortalCard";
import PortalPhotoCard from "./PortalPhotoCard";
import ShortsViewer from "./ShortsViewer";
import { usePortalList, type PortalList } from "./usePortalList";
import { useSupabaseSession } from "../../lib/auth";
import type { FeedCursor } from "../../lib/feed";
import { fetchFollowingPortalPage, fetchPortalVehicle, searchPortalPage, type PortalVehicle } from "../../lib/portal";
import { EMPTY_FILTERS, SORT_LABELS, type SortOrder } from "../../lib/search";
import { useFollowVersion } from "../../lib/use-follow";
import type { HomeFilters } from "../../lib/use-home-filters";
import { useMyProfile } from "../../lib/use-my-profile";

// Masaüstü ana sayfa (1024 px ve üstü): ilan arama ve vitrin portalı. Üstte
// sabit başlık (logo, Takip Edilenler | Keşfet, favoriler, İlan Ver, profil),
// altında yatay filtre konsolu. Keşfet iki bölüm: "Sizin için videolar"
// (9:16 kartlar, 4 / xl'de 5 sütun, ilk VIDEO_PAGE kart, "Daha fazla video
// göster") ve altında "Görselli ilanlar" (llex.az gibi 4:3 fotoğraflı klasik
// ilan kartları, sonsuz kaydırma). İkisi aynı aramanın sonuçlarıdır (videolu /
// fotoğraflı olanlar). Karta tıklamak sayfayı yenilemeden tam ekran Shorts
// oynatıcısını açar (ShortsViewer); ↑/↓ ve fare tekerleği kartın bölümünde
// gezinir, kapatınca vitrin olduğu yerde kalır ve odak son izlenen karta
// döner. Filtreler ve açık ilan adreste (?marka=…&v=…).

const PANEL_IDS: Record<FeedTab, string> = { following: "portal-panel-following", explore: "portal-panel-explore" };
// Sona bu kadar kala sonraki sayfa istenir (ızgarada ve oynatıcıda)
const PREFETCH_DISTANCE = 4;
/** Yapışkan başlığın yüksekliği (h-16): altında kalan kart görünmüyor sayılır */
const HEADER_HEIGHT = 64;
/** "Sizin için videolar" bölümü önce bu kadar kart (xl'de iki satır) gösterir; düğme bu kadar ekler */
export const VIDEO_PAGE = 10;

/** Oynatıcının açıldığı liste: ↑/↓ onun içinde gezinir */
type ModalSource = "videos" | "photos" | "following";
/** direction: ilana hangi adımla gelindi (oynatıcıda kayarak geçişin yönü; 0 ilk açılış) */
type ModalState = { source: ModalSource; vehicle: PortalVehicle; direction: -1 | 0 | 1 };

const hasVideo = (vehicle: PortalVehicle) => Boolean(vehicle.hlsUrl);
const hasPhoto = (vehicle: PortalVehicle) => Boolean(vehicle.photoUrl);

/** Bir listenin süzülmüş görünümü: sonraki sayfa, süzgece uyan yeni kart gelene ya da liste bitene kadar istenir */
type ListView = { items: PortalVehicle[]; hasMore: boolean; more: PortalList["more"]; loadMore: () => Promise<PortalVehicle[]> };

function viewOf(list: PortalList, keep: (vehicle: PortalVehicle) => boolean = () => true): ListView {
  return {
    items: list.items.filter(keep),
    hasMore: list.hasMore,
    more: list.more,
    loadMore: async () => {
      for (;;) {
        const fresh = await list.loadMore();
        if (fresh.length === 0) return [];
        const matching = fresh.filter(keep);
        if (matching.length > 0) return matching;
      }
    },
  };
}

export default function DesktopPortal({
  home,
  initialVehicleId,
  initialTab,
}: {
  home: HomeFilters;
  initialVehicleId: string | null;
  initialTab: FeedTab;
}) {
  const [tab, setTab] = useState<FeedTab>(initialTab);
  const [followingOpened, setFollowingOpened] = useState(initialTab === "following");
  const { session, isLoading: sessionLoading } = useSupabaseSession();
  const { profile } = useMyProfile();
  const followVersion = useFollowVersion();
  const [now] = useState(() => new Date());
  const [modal, setModal] = useState<ModalState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLAnchorElement>());
  const sortId = useId();

  const { filters, key: filterKey, setVehicleParam } = home;
  const fetchExplore = useCallback(
    (cursor: number | null) => searchPortalPage(filters ?? EMPTY_FILTERS, cursor ?? 0),
    [filters],
  );
  const explore = usePortalList(filterKey, fetchExplore);
  const followingKey = followingOpened && session ? `following:${session.user.id}:${followVersion}` : null;
  const fetchFollowing = useCallback((cursor: FeedCursor | null) => fetchFollowingPortalPage(cursor), []);
  const following = usePortalList(followingKey, fetchFollowing);
  const views: Record<ModalSource, ListView> = {
    videos: viewOf(explore, hasVideo),
    photos: viewOf(explore, hasPhoto),
    following: viewOf(following),
  };
  // Video bölümünde gösterilen kart sayısı; filtre değişince başa döner
  const [videoLimitState, setVideoLimitState] = useState({ key: filterKey, limit: VIDEO_PAGE });
  const videoLimit = videoLimitState.key === filterKey ? videoLimitState.limit : VIDEO_PAGE;
  const showVideos = (limit: number) => setVideoLimitState({ key: filterKey, limit });

  // /?v=<ilan> bağlantısı: vitrin o ilanın Shorts oynatıcısıyla açılır
  const pinnedRef = useRef(initialVehicleId);
  useEffect(() => {
    const id = pinnedRef.current;
    if (!id) return;
    pinnedRef.current = null;
    let active = true;
    fetchPortalVehicle(id)
      .then((vehicle) => {
        if (!active) return;
        if (vehicle) setModal({ source: initialTab === "following" ? "following" : "videos", vehicle, direction: 0 });
        else {
          setVehicleParam(null);
          setNotice("Açmak istediğin ilan artık yayında değil. Vitrindeki diğer ilanları gösteriyoruz.");
        }
      })
      .catch((error) => {
        console.error("Paylaşılan ilan yüklenemedi:", error);
        if (active) setVehicleParam(null);
      });
    return () => {
      active = false;
    };
  }, [initialTab, setVehicleParam]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function selectTab(next: FeedTab) {
    setTab(next);
    if (next === "following") setFollowingOpened(true);
  }

  function openVehicle(vehicle: PortalVehicle, source: ModalSource) {
    setModal({ source, vehicle, direction: 0 });
    setVehicleParam(vehicle.id);
  }

  function closeModal() {
    const last = modal ? cardKey(modal.source, modal.vehicle.id) : null;
    setModal(null);
    setVehicleParam(null);
    // Oynatıcı kalktıktan sonra: son izlenen karta odak. Vitrin kaldığı yerde
    // kalır; yalnızca oynatıcıda ↑/↓ ile gidilen kart tamamen ekran dışındaysa oraya kaydırılır
    window.setTimeout(() => {
      const card = last ? cardRefs.current.get(last) : undefined;
      if (!card) return;
      card.focus({ preventScroll: true });
      const rect = card.getBoundingClientRect();
      if (rect.bottom <= HEADER_HEIGHT || rect.top >= window.innerHeight) card.scrollIntoView({ block: "center" });
    }, 0);
  }

  const modalList = modal ? views[modal.source] : null;
  const modalIndex = modal && modalList ? modalList.items.findIndex((item) => item.id === modal.vehicle.id) : -1;

  function stepModal(step: -1 | 1) {
    if (!modal || !modalList) return;
    const items = modalList.items;
    const go = (vehicle: PortalVehicle) => {
      setModal({ source: modal.source, vehicle, direction: step });
      setVehicleParam(vehicle.id);
      // Video bölümünde gizli kalan karta gidildiyse bölüm genişler (kapanınca odak ona döner)
      if (modal.source === "videos") {
        const index = views.videos.items.findIndex((item) => item.id === vehicle.id);
        if (index >= videoLimit) showVideos(Math.ceil((index + 1) / VIDEO_PAGE) * VIDEO_PAGE);
      }
    };
    // Listede olmayan (paylaşılan) ilandan sonra listenin başı gelir
    if (modalIndex === -1) {
      if (step === 1 && items[0]) go(items[0]);
      return;
    }
    const target = modalIndex + step;
    if (target < 0) return;
    if (target < items.length) {
      go(items[target]);
      if (target >= items.length - PREFETCH_DISTANCE && modalList.hasMore) void modalList.loadMore();
      return;
    }
    if (modalList.hasMore) {
      const from = modal.vehicle.id;
      void modalList.loadMore().then((fresh) => {
        // Bu arada başka ilana geçildiyse ya da oynatıcı kapandıysa atla
        if (fresh[0] && modalRef.current?.vehicle.id === from) go(fresh[0]);
      });
    }
  }
  const modalRef = useRef(modal);
  useEffect(() => {
    modalRef.current = modal;
  }, [modal]);

  function showResults() {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultsRef.current?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  }

  const cardProps = {
    now,
    previewEnabled: modal === null,
    onOpen: openVehicle,
    registerCard: (key: string, element: HTMLAnchorElement | null) => {
      if (element) cardRefs.current.set(key, element);
      else cardRefs.current.delete(key);
    },
  };

  function showMoreVideos() {
    const next = videoLimit + VIDEO_PAGE;
    showVideos(next);
    if (views.videos.items.length < next && explore.hasMore) void views.videos.loadMore();
  }

  const activeFilters = home.activeCount > 0;
  const videoItems = views.videos.items;
  const photoItems = views.photos.items;
  const countText = (count: number, noun: string) => `${count}${explore.hasMore ? "+" : ""} ${noun}`;
  const exploreEmpty = activeFilters ? (
    <GridMessage
      title="Bu filtrelere uyan ilan yok."
      detail="Fiyat ya da yıl aralığını genişletmeyi veya bir filtreyi kaldırmayı dene."
      actionLabel="Filtreleri Sıfırla"
      onAction={() => home.filters && home.apply({ ...EMPTY_FILTERS, sort: home.filters.sort })}
    />
  ) : (
    <GridMessage title="Şu an yayında ilan yok." detail="Satıcılar videolu ilan ekledikçe burada göreceksin." />
  );

  return (
    <div className="min-h-dvh bg-[#121212] text-white">
      <header className="sticky top-0 z-30 border-b border-[#27272A] bg-[#121212]/95 backdrop-blur-[6px]">
        <div className="@container mx-auto grid h-16 max-w-[1440px] grid-cols-[1fr_auto_1fr] items-center gap-x-4 px-6 xl:px-8">
          <Link
            href="/"
            aria-label="gözüyle ana sayfa"
            className="flex h-11 items-center justify-self-start rounded-md px-1 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Logo className="h-9 text-white" iconClassName="h-9 w-9" />
          </Link>
          <h1 className="sr-only">gözüyle: videolu araç ilanları</h1>

          <FeedTabs active={tab} onChange={selectTab} panelIds={PANEL_IDS} />

          <div className="flex items-center justify-self-end gap-2">
            <Link
              href="/favorites"
              aria-label="Favorilerim"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Heart aria-hidden="true" className="h-5 w-5" />
            </Link>
            <AuthGatedLink
              href="/sell"
              aria-label="İlan Ver"
              className="flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/40 px-4 text-[15px] font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
              İlan Ver
            </AuthGatedLink>
            <HeaderProfileButton overlay />
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1440px] px-6 pb-16 xl:px-8">
        {tab === "explore" ? (
          <div id={PANEL_IDS.explore} role="tabpanel" aria-labelledby="feed-tab-explore">
            <div className="pt-5">
              {home.filters ? (
                <FilterConsole
                  catalog={home.catalog}
                  catalogFailed={home.catalogFailed}
                  filters={home.filters}
                  activeCount={home.activeCount}
                  onApply={home.apply}
                  onShowResults={showResults}
                />
              ) : (
                <div aria-hidden="true" className="h-[170px] rounded-2xl bg-[#18181B] ring-1 ring-inset ring-[#27272A] motion-safe:animate-pulse" />
              )}
            </div>

            <div ref={resultsRef} className="mt-6 mb-4 flex scroll-mt-20 items-end justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-[24px] font-semibold leading-tight [font-family:var(--font-display)]">
                  {activeFilters ? "Filtreye uyan videolar" : "Sizin için videolar"}
                </h2>
                <p aria-live="polite" className="mt-0.5 text-[14px] text-[#A1A1AA]">
                  {explore.items.length > 0 && !explore.loading
                    ? countText(videoItems.length, "videolu ilan")
                    : explore.loading || !home.filters
                      ? "İlanlar yükleniyor…"
                      : ""}
                </p>
              </div>
              {home.filters && (
                <div className="flex shrink-0 items-center gap-2">
                  <label htmlFor={sortId} className="text-[14px] text-[#A1A1AA]">
                    Sırala
                  </label>
                  <select
                    id={sortId}
                    value={home.filters.sort}
                    onChange={(event) => home.filters && home.apply({ ...home.filters, sort: event.target.value as SortOrder })}
                    className="h-10 rounded-lg bg-[#18181B] px-2.5 text-[14px] font-semibold text-white ring-1 ring-inset ring-[#3F3F46] [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    {(Object.keys(SORT_LABELS) as SortOrder[]).map((sort) => (
                      <option key={sort} value={sort}>
                        {SORT_LABELS[sort]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {home.filters ? (
              <PortalGrid
                list={explore}
                items={videoItems.slice(0, videoLimit)}
                label="Videolu ilanlar"
                paging={{
                  kind: "button",
                  canShowMore: videoItems.length > videoLimit || explore.hasMore,
                  onShowMore: showMoreVideos,
                  label: "Daha fazla video göster",
                }}
                source="videos"
                {...cardProps}
                empty={
                  explore.items.length > 0 ? (
                    <p className="rounded-xl bg-[#18181B] px-4 py-6 text-center text-[15px] text-[#A1A1AA]">
                      Bu sonuçlarda videolu ilan yok; fotoğraflı ilanlar aşağıda.
                    </p>
                  ) : (
                    exploreEmpty
                  )
                }
              />
            ) : (
              <GridSkeleton />
            )}

            {home.filters && explore.items.length > 0 && (
              <section aria-labelledby="photo-listings-title" className="mt-14 border-t border-[#27272A] pt-8">
                <div className="mb-4">
                  <h2 id="photo-listings-title" className="text-[24px] font-semibold leading-tight [font-family:var(--font-display)]">
                    {activeFilters ? "Filtreye uyan görselli ilanlar" : "Görselli ilanlar"}
                  </h2>
                  <p className="mt-0.5 text-[14px] text-[#A1A1AA]">{countText(photoItems.length, "fotoğraflı ilan")} · tüm ilanlar</p>
                </div>
                <PortalGrid
                  list={explore}
                  items={photoItems}
                  label="Görselli ilanlar"
                  card="photo"
                  showErrors={false}
                  paging={{ kind: "infinite" }}
                  source="photos"
                  {...cardProps}
                  empty={
                    <p className="rounded-xl bg-[#18181B] px-4 py-6 text-center text-[15px] text-[#A1A1AA]">
                      Bu sonuçlarda fotoğraflı ilan yok.
                    </p>
                  }
                />
              </section>
            )}
          </div>
        ) : (
          <div id={PANEL_IDS.following} role="tabpanel" aria-labelledby="feed-tab-following">
            <div className="mt-6 mb-4">
              <h2 className="text-[24px] font-semibold leading-tight [font-family:var(--font-display)]">Takip Edilenler</h2>
              <p className="mt-0.5 text-[14px] text-[#A1A1AA]">Takip ettiğin satıcıların videolu ilanları</p>
            </div>
            {sessionLoading ? (
              <GridSkeleton />
            ) : !session ? (
              <div className="flex justify-center py-10">
                <FollowingEmpty kind="guest" onExplore={() => selectTab("explore")} onSignIn={() => setShowAuth(true)} />
              </div>
            ) : (
              <PortalGrid
                list={following}
                label="Takip edilen satıcıların ilanları"
                paging={{ kind: "infinite" }}
                source="following"
                {...cardProps}
                empty={
                  <div className="flex justify-center py-10">
                    <FollowingEmpty
                      kind={profile && profile.followingCount > 0 ? "quiet" : "none"}
                      onExplore={() => selectTab("explore")}
                    />
                  </div>
                }
              />
            )}
          </div>
        )}
      </div>

      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-20 z-40 flex justify-center px-6">
        {notice && <p className="max-w-md rounded-lg bg-black/85 px-4 py-3 text-center text-[14px] leading-snug text-white">{notice}</p>}
      </div>

      {modal && modalList && (
        <ShortsViewer
          vehicle={modal.vehicle}
          direction={modal.direction}
          hasPrev={modalIndex > 0}
          hasNext={modalIndex === -1 ? modalList.items.length > 0 : modalIndex < modalList.items.length - 1 || modalList.hasMore}
          loadingNext={modalList.more === "loading"}
          neighbors={{
            prev: modalIndex > 0 ? modalList.items[modalIndex - 1] : null,
            next: modalList.items[modalIndex + 1] ?? null,
          }}
          onStep={stepModal}
          onClose={closeModal}
        />
      )}

      {showAuth &&
        createPortal(
          <AuthModalPortal
            onClose={() => setShowAuth(false)}
            onAuthenticated={() => setShowAuth(false)}
            oauthReturnTo="/?feed=following"
          />,
          document.body,
        )}
    </div>
  );
}

/** Aynı ilan iki bölümde (video ve görselli) olabilir: odak referansı bölümüyle tutulur */
function cardKey(source: ModalSource, id: string): string {
  return `${source}:${id}`;
}

type Paging = { kind: "infinite" } | { kind: "button"; canShowMore: boolean; onShowMore: () => void; label: string };

function PortalGrid({
  list,
  items = list.items,
  label,
  card = "video",
  paging,
  showErrors = true,
  source,
  empty,
  now,
  previewEnabled,
  onOpen,
  registerCard,
}: {
  list: PortalList;
  /** Gösterilen kartlar (varsayılan: listenin tamamı) */
  items?: PortalVehicle[];
  label: string;
  /** video: 9:16 kart, fareyle önizleme; photo: 4:3 klasik ilan kartı */
  card?: "video" | "photo";
  /** infinite: sona yaklaşınca sonraki sayfa; button: yalnızca düğmeyle */
  paging: Paging;
  /** Aynı listenin ikinci ızgarası hata şeridini tekrarlamaz */
  showErrors?: boolean;
  /** Oynatıcı bu bölümden açılır (↑/↓ bu bölümde gezinir) */
  source: ModalSource;
  empty: ReactNode;
  now: Date;
  previewEnabled: boolean;
  onOpen: (vehicle: PortalVehicle, source: ModalSource) => void;
  registerCard: (key: string, element: HTMLAnchorElement | null) => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { hasMore, more, loadMore } = list;
  const infinite = paging.kind === "infinite";

  // Sonsuz kaydırma: ızgaranın sonuna yaklaşınca sonraki sayfa (hata olduysa düğmeyle)
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!infinite || !sentinel || !hasMore || more === "error") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "900px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [infinite, hasMore, more, loadMore]);

  if (list.initial) return <GridSkeleton card={card} />;
  if (list.failed && list.items.length === 0) {
    return (
      <GridMessage
        title="İlanlar yüklenemedi."
        detail="İnternet bağlantını kontrol edip tekrar dene."
        actionLabel="Tekrar dene"
        onAction={list.retry}
      />
    );
  }
  if (!list.loading && items.length === 0) return <>{empty}</>;

  return (
    <>
      {showErrors && list.failed && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-[#3F1D1D] px-4 py-3 text-[14px] text-[#FCA5A5]">
          <span>İlanlar güncellenemedi; gördüğün sonuçlar eski olabilir.</span>
          <button
            type="button"
            onClick={list.retry}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-semibold text-white underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Tekrar dene
          </button>
        </div>
      )}
      <ul
        aria-label={label}
        aria-busy={list.loading}
        className={`grid grid-cols-4 gap-4 transition-opacity duration-200 xl:grid-cols-5 ${list.loading ? "opacity-50" : "opacity-100"}`}
      >
        {items.map((vehicle, index) => (
          <li key={vehicle.id} className="min-w-0">
            {card === "photo" ? (
              <PortalPhotoCard
                vehicle={vehicle}
                eager={false}
                now={now}
                onOpen={() => onOpen(vehicle, source)}
                linkRef={(element) => registerCard(cardKey(source, vehicle.id), element)}
              />
            ) : (
              <PortalCard
                vehicle={vehicle}
                eager={index < 5}
                previewEnabled={previewEnabled}
                now={now}
                onOpen={() => onOpen(vehicle, source)}
                linkRef={(element) => registerCard(cardKey(source, vehicle.id), element)}
              />
            )}
          </li>
        ))}
      </ul>

      {paging.kind === "button" && paging.canShowMore && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={paging.onShowMore}
            disabled={more === "loading"}
            className="h-11 rounded-full bg-[#27272A] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[#3F3F46] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {more === "loading" ? "Yükleniyor…" : paging.label}
          </button>
        </div>
      )}

      {infinite && hasMore && (
        <div ref={sentinelRef} className="mt-10 flex flex-col items-center gap-3">
          <div role="status" aria-live="polite">
            {more === "error" && (
              <p className="text-center text-[14px] text-[#FCA5A5]">Daha fazla ilan yüklenemedi. Bağlantını kontrol edip tekrar dene.</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={more === "loading"}
            className="h-11 rounded-full bg-[#27272A] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[#3F3F46] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {more === "loading" ? "Yükleniyor…" : more === "error" ? "Tekrar dene" : "Daha fazla ilan göster"}
          </button>
        </div>
      )}
    </>
  );
}

function GridSkeleton({ card = "video" }: { card?: "video" | "photo" }) {
  return (
    <ul aria-hidden="true" className="grid grid-cols-4 gap-4 xl:grid-cols-5">
      {Array.from({ length: 10 }, (_, index) => (
        <li key={index} className="motion-safe:animate-pulse">
          <div className={`${card === "photo" ? "aspect-[4/3]" : "aspect-[9/16]"} rounded-xl bg-[#18181B]`} />
          <div className="mt-2.5 h-4 w-3/4 rounded bg-[#27272A]" />
          <div className="mt-2 h-7 w-1/2 rounded bg-[#1F1F23]" />
        </li>
      ))}
    </ul>
  );
}

function GridMessage({
  title,
  detail,
  actionLabel,
  onAction,
}: {
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div role="status" className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <div>
        <p className="text-[18px] font-semibold">{title}</p>
        <p className="mt-1 text-[15px] text-[#A1A1AA]">{detail}</p>
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="h-11 rounded-full bg-white px-5 text-[15px] font-semibold text-[#121212] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#121212]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Sunucu çizimi ve hidrasyon anı (ekran genişliği henüz bilinmiyor): masaüstünde
 * boş sayfa yerine vitrinin iskeleti. Mobilde gizli (lg:block).
 */
export function DesktopPortalSkeleton() {
  return (
    <div aria-hidden="true" className="hidden min-h-dvh bg-[#121212] lg:block">
      <div className="h-16 border-b border-[#27272A]" />
      <div className="mx-auto w-full max-w-[1440px] px-6 pt-5 xl:px-8">
        <div className="h-[170px] rounded-2xl bg-[#18181B] ring-1 ring-inset ring-[#27272A] motion-safe:animate-pulse" />
        <div className="mt-6 mb-4 h-12 w-56 rounded-lg bg-[#18181B] motion-safe:animate-pulse" />
        <GridSkeleton />
      </div>
    </div>
  );
}
