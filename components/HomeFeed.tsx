"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { AuthModalPortal } from "./AuthGatedLink";
import FeedHeader from "./FeedHeader";
import VideoFeed from "./VideoFeed";
import FeedFilterButton, { FilteredFeedEmpty } from "./feed/FeedFilterButton";
import DesktopPortal, { DesktopPortalSkeleton } from "./portal/DesktopPortal";
import FeedTabs, { type FeedTab } from "./social/FeedTabs";
import FollowingEmpty from "./social/FollowingEmpty";
import { useSupabaseSession } from "../lib/auth";
import { DESKTOP_MEDIA_QUERY } from "../lib/feed-navigation";
import { EMPTY_FILTERS } from "../lib/search";
import { useFollowVersion } from "../lib/use-follow";
import { useHomeFilters, type HomeFilters } from "../lib/use-home-filters";
import { useResolvedMediaQuery } from "../lib/use-media-query";
import { useMyProfile } from "../lib/use-my-profile";

const PANEL_IDS: Record<FeedTab, string> = { following: "feed-panel-following", explore: "feed-panel-explore" };

// Ana sayfa iki ayrı görünümdür; ekran genişliği belli olunca yalnızca biri
// kurulur (ikisi de ayrı veri ister):
//
// Mobil (1024 px'ten dar): tam ekran dikey video akışı, "Keşfet" ve "Takip
// Edilenler" sekmeleri, sağ düğme sütunu. Sol üstteki "Filtrele" hapı video
// durmadan filtre penceresini açar; filtre uygulanınca Keşfet o filtreye uyan
// videolu ilanlardan kurulur.
//
// Masaüstü (1024 px ve üstü): ilan arama ve vitrin portalı (components/portal):
// filtre konsolu, 9:16 kart ızgarası, bölünmüş pencere.
//
// İkisi aynı adresi okur (/?marka=bmw&minFiyat=…): paylaşılan bağlantı
// masaüstünde vitrini, telefonda filtreli akışı açar.
export default function HomeFeed({
  initialVehicleId,
  initialTab = "explore",
}: {
  initialVehicleId: string | null;
  initialTab?: FeedTab;
}) {
  const isDesktop = useResolvedMediaQuery(DESKTOP_MEDIA_QUERY);
  const home = useHomeFilters({ eagerCatalog: isDesktop === true });

  if (isDesktop) return <DesktopPortal home={home} initialVehicleId={initialVehicleId} initialTab={initialTab} />;
  return (
    <>
      <MobileHome home={home} resolved={isDesktop === false} initialVehicleId={initialVehicleId} initialTab={initialTab} />
      {/* Sunucu çizimi ve hidrasyon: genişlik bilinmiyor, masaüstünde iskelet görünür */}
      {isDesktop === null && <DesktopPortalSkeleton />}
    </>
  );
}

function MobileHome({
  home,
  resolved,
  initialVehicleId,
  initialTab,
}: {
  home: HomeFilters;
  /** Ekran genişliği belli: akış kurulabilir (sunucuda ve hidrasyonda false) */
  resolved: boolean;
  initialVehicleId: string | null;
  initialTab: FeedTab;
}) {
  const [tab, setTab] = useState<FeedTab>(initialTab);
  const { session, isLoading } = useSupabaseSession();
  const { profile } = useMyProfile();
  const followVersion = useFollowVersion();
  // Takip Edilenler akışı hangi takip listesiyle kuruldu (sekmeye her geçişte güncellenir)
  const [followingKey, setFollowingKey] = useState<number | null>(initialTab === "following" ? followVersion : null);
  const [showAuth, setShowAuth] = useState(false);
  // "Videoyu akışta izle" (/?v=): filtre değişince akış o ilanla değil, baştan kurulur
  const [pinnedId, setPinnedId] = useState(initialVehicleId);

  function selectTab(next: FeedTab) {
    setTab(next);
    if (next === "following" && followingKey !== followVersion) setFollowingKey(followVersion);
  }

  function applyFilters(next: typeof EMPTY_FILTERS) {
    setPinnedId(null);
    home.apply(next);
  }

  const followingVisible = tab === "following";
  const filtered = home.activeCount > 0 && home.filters ? home.filters : null;

  return (
    // lg: masaüstü düzeni kurulana kadar (sunucu çizimi) mobil kabuk gizli kalır
    <div className="relative h-full w-full lg:hidden">
      <div
        id={PANEL_IDS.explore}
        role="tabpanel"
        aria-labelledby="feed-tab-explore"
        inert={followingVisible}
        className={`absolute inset-0 ${followingVisible ? "invisible" : ""}`}
      >
        {resolved && home.filters ? (
          <VideoFeed
            key={`${pinnedId ?? "feed"}|${home.key ?? ""}`}
            initialVehicleId={pinnedId}
            filters={filtered}
            visible={!followingVisible}
            emptyState={
              filtered ? (
                <FilteredFeedEmpty onClear={() => applyFilters({ ...EMPTY_FILTERS, sort: filtered.sort })} />
              ) : undefined
            }
          />
        ) : (
          <FeedLoading />
        )}
      </div>

      <div
        id={PANEL_IDS.following}
        role="tabpanel"
        aria-labelledby="feed-tab-following"
        inert={!followingVisible}
        className={`absolute inset-0 bg-[#121212] ${followingVisible ? "" : "invisible"}`}
      >
        {!resolved || isLoading ? null : !session ? (
          followingVisible && (
            <div className="flex h-full flex-col items-center overflow-y-auto px-5 pt-[calc(env(safe-area-inset-top)+4.5rem)] pb-5">
              <FollowingEmpty kind="guest" onExplore={() => selectTab("explore")} onSignIn={() => setShowAuth(true)} />
            </div>
          )
        ) : (
          followingKey !== null && (
            <VideoFeed
              key={`${session.user.id}:${followingKey}`}
              source="following"
              visible={followingVisible}
              emptyState={
                <FollowingEmpty kind={profile && profile.followingCount > 0 ? "quiet" : "none"} onExplore={() => selectTab("explore")} />
              }
            />
          )
        )}
      </div>

      <FeedHeader center={<FeedTabs active={tab} onChange={selectTab} panelIds={PANEL_IDS} />} />

      {!followingVisible && <FeedFilterButton home={home} onApply={applyFilters} />}

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

/** Akış kurulana kadar (ekran genişliği ya da filtre için katalog bekleniyor): akışın yükleme görünümü */
function FeedLoading() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-[#121212] px-10 text-center">
      <span aria-hidden="true" className="h-8 w-8 rounded-full border-2 border-white/25 border-t-white motion-safe:animate-spin" />
      <p className="text-[15px] text-white/75">İlanlar yükleniyor</p>
    </div>
  );
}
