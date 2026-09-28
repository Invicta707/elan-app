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
import PortalModal from "./PortalModal";
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
// altında yatay filtre konsolu ve 9:16 kart ızgarası (4, xl'de 5 sütun).
// Karta tıklamak sayfayı yenilemeden bölünmüş pencereyi açar; ↑/↓ listede
// gezinir, kapatınca vitrin olduğu yerde kalır ve odak son izlenen karta döner.
// Filtreler ve açık ilan adreste (?marka=…&v=…): yenileme ve paylaşım korunur.

const PANEL_IDS: Record<FeedTab, string> = { following: "portal-panel-following", explore: "portal-panel-explore" };
// Sona bu kadar kala sonraki sayfa istenir (ızgarada ve pencerede)
const PREFETCH_DISTANCE = 4;
/** Yapışkan başlığın yüksekliği (h-16): altında kalan kart görünmüyor sayılır */
const HEADER_HEIGHT = 64;

type ModalState = { source: FeedTab; vehicle: PortalVehicle };

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
  const [muted, setMuted] = useState(false);
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
  const lists: Record<FeedTab, PortalList> = { explore, following };

  // /?v=<ilan> bağlantısı: vitrin o ilanın penceresiyle açılır
  const pinnedRef = useRef(initialVehicleId);
  useEffect(() => {
    const id = pinnedRef.current;
    if (!id) return;
    pinnedRef.current = null;
    let active = true;
    fetchPortalVehicle(id)
      .then((vehicle) => {
        if (!active) return;
        if (vehicle) setModal({ source: initialTab, vehicle });
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

  function openVehicle(vehicle: PortalVehicle) {
    setModal({ source: tab, vehicle });
    setVehicleParam(vehicle.id);
  }

  function closeModal() {
    const lastId = modal?.vehicle.id;
    setModal(null);
    setVehicleParam(null);
    // Pencere kalktıktan sonra: son izlenen karta odak. Vitrin kaldığı yerde
    // kalır; yalnızca pencerede ↑/↓ ile gidilen kart tamamen ekran dışındaysa oraya kaydırılır
    window.setTimeout(() => {
      const card = lastId ? cardRefs.current.get(lastId) : undefined;
      if (!card) return;
      card.focus({ preventScroll: true });
      const rect = card.getBoundingClientRect();
      if (rect.bottom <= HEADER_HEIGHT || rect.top >= window.innerHeight) card.scrollIntoView({ block: "center" });
    }, 0);
  }

  const modalList = modal ? lists[modal.source] : null;
  const modalIndex = modal && modalList ? modalList.items.findIndex((item) => item.id === modal.vehicle.id) : -1;

  function stepModal(step: -1 | 1) {
    if (!modal || !modalList) return;
    const items = modalList.items;
    const go = (vehicle: PortalVehicle) => {
      setModal({ source: modal.source, vehicle });
      setVehicleParam(vehicle.id);
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
        // Bu arada başka ilana geçildiyse ya da pencere kapandıysa atla
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
    registerCard: (id: string, element: HTMLAnchorElement | null) => {
      if (element) cardRefs.current.set(id, element);
      else cardRefs.current.delete(id);
    },
  };

  const activeFilters = home.activeCount > 0;

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
                  {activeFilters ? "Filtreye uyan ilanlar" : "Tüm ilanlar"}
                </h2>
                <p aria-live="polite" className="mt-0.5 text-[14px] text-[#A1A1AA]">
                  {explore.items.length > 0 && !explore.loading
                    ? `${explore.items.length}${explore.hasMore ? "+" : ""} ilan`
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
                {...cardProps}
                empty={
                  activeFilters ? (
                    <GridMessage
                      title="Bu filtrelere uyan ilan yok."
                      detail="Fiyat ya da yıl aralığını genişletmeyi veya bir filtreyi kaldırmayı dene."
                      actionLabel="Filtreleri Sıfırla"
                      onAction={() => home.filters && home.apply({ ...EMPTY_FILTERS, sort: home.filters.sort })}
                    />
                  ) : (
                    <GridMessage title="Şu an yayında ilan yok." detail="Satıcılar videolu ilan ekledikçe burada göreceksin." />
                  )
                }
              />
            ) : (
              <GridSkeleton />
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
        <PortalModal
          vehicle={modal.vehicle}
          position={modalIndex === -1 ? null : modalIndex + 1}
          total={modalList.items.length}
          moreAvailable={modalList.hasMore}
          hasPrev={modalIndex > 0}
          hasNext={modalIndex === -1 ? modalList.items.length > 0 : modalIndex < modalList.items.length - 1 || modalList.hasMore}
          loadingNext={modalList.more === "loading"}
          neighborSellerIds={[
            modalList.items[modalIndex - 1]?.sellerId ?? null,
            modalList.items[modalIndex + 1]?.sellerId ?? null,
          ]}
          muted={muted}
          onMutedChange={setMuted}
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

function PortalGrid({
  list,
  empty,
  now,
  previewEnabled,
  onOpen,
  registerCard,
}: {
  list: PortalList;
  empty: ReactNode;
  now: Date;
  previewEnabled: boolean;
  onOpen: (vehicle: PortalVehicle) => void;
  registerCard: (id: string, element: HTMLAnchorElement | null) => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { hasMore, more, loadMore } = list;

  // Sonsuz kaydırma: ızgaranın sonuna yaklaşınca sonraki sayfa (hata olduysa düğmeyle)
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || more === "error") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "900px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, more, loadMore]);

  if (list.initial) return <GridSkeleton />;
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
  if (!list.loading && list.items.length === 0) return <>{empty}</>;

  return (
    <>
      {list.failed && (
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
        aria-label="İlanlar"
        aria-busy={list.loading}
        className={`grid grid-cols-4 gap-4 transition-opacity duration-200 xl:grid-cols-5 ${list.loading ? "opacity-50" : "opacity-100"}`}
      >
        {list.items.map((vehicle, index) => (
          <li key={vehicle.id} className="min-w-0">
            <PortalCard
              vehicle={vehicle}
              eager={index < 5}
              previewEnabled={previewEnabled}
              now={now}
              onOpen={() => onOpen(vehicle)}
              linkRef={(element) => registerCard(vehicle.id, element)}
            />
          </li>
        ))}
      </ul>

      {hasMore && (
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

function GridSkeleton() {
  return (
    <ul aria-hidden="true" className="grid grid-cols-4 gap-4 xl:grid-cols-5">
      {Array.from({ length: 10 }, (_, index) => (
        <li key={index} className="motion-safe:animate-pulse">
          <div className="aspect-[9/16] rounded-xl bg-[#18181B]" />
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
