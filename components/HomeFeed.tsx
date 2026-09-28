"use client";

import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AuthModalPortal } from "./AuthGatedLink";
import FeedHeader from "./FeedHeader";
import VideoFeed from "./VideoFeed";
import DesktopFeedPanel, { PanelToolbar } from "./feed/DesktopFeedPanel";
import { FeedPanelContext, type FeedPanel } from "./feed/FeedPanelContext";
import FeedTabs, { type FeedTab } from "./social/FeedTabs";
import FollowingEmpty from "./social/FollowingEmpty";
import { useSupabaseSession } from "../lib/auth";
import type { FeedVehicle } from "../lib/feed";
import { DESKTOP_MEDIA_QUERY } from "../lib/feed-navigation";
import { useFollowVersion } from "../lib/use-follow";
import { useMediaQuery } from "../lib/use-media-query";
import { useMyProfile } from "../lib/use-my-profile";

const PANEL_IDS: Record<FeedTab, string> = { following: "feed-panel-following", explore: "feed-panel-explore" };

// Ana sayfa: "Keşfet" (bütün yayındaki ilanlar) ve "Takip Edilenler" (takip
// edilen satıcıların videoları). Sekme değişince diğer akış silinmez, gizlenir:
// Keşfet'e dönülünce kalınan yerden devam edilir. "Takip Edilenler" ilk kez
// açılınca kurulur; bu arada biri takip edilir ya da bırakılırsa yeniden kurulur.
//
// Mobil (1024 px'ten dar): tam ekran dikey akış, sağ düğme sütunu, alttan
// açılan yorum penceresi. Masaüstü (1024 px ve üstü, TikTok Web modeli): solda
// 9:16 video sütunu (klavye ok tuşları ve fare tekerleğiyle ilan ilan),
// sağda ekrandaki ilanın ayrıntıları ve yorumlarıyla kalıcı koyu panel.
export default function HomeFeed({
  initialVehicleId,
  initialTab = "explore",
}: {
  initialVehicleId: string | null;
  initialTab?: FeedTab;
}) {
  const [tab, setTab] = useState<FeedTab>(initialTab);
  const [muted, setMuted] = useState(true);
  const { session, isLoading } = useSupabaseSession();
  const { profile } = useMyProfile();
  const followVersion = useFollowVersion();
  // Takip Edilenler akışı hangi takip listesiyle kuruldu (sekmeye her geçişte güncellenir)
  const [followingKey, setFollowingKey] = useState<number | null>(initialTab === "following" ? followVersion : null);
  const [showAuth, setShowAuth] = useState(false);

  // Masaüstü yan panel: her akışın ekrandaki ilanı (undefined: akış henüz yüklenmedi)
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const [activeByTab, setActiveByTab] = useState<Record<FeedTab, FeedVehicle | null | undefined>>({
    explore: undefined,
    following: undefined,
  });
  const onExploreActive = useCallback((vehicle: FeedVehicle | null) => setActiveByTab((current) => ({ ...current, explore: vehicle })), []);
  const onFollowingActive = useCallback(
    (vehicle: FeedVehicle | null) => setActiveByTab((current) => ({ ...current, following: vehicle })),
    [],
  );
  const [focusRequest, setFocusRequest] = useState(0);
  const panel = useMemo<FeedPanel | null>(
    () => (isDesktop ? { focusComments: () => setFocusRequest((count) => count + 1) } : null),
    [isDesktop],
  );

  function selectTab(next: FeedTab) {
    setTab(next);
    if (next === "following" && followingKey !== followVersion) setFollowingKey(followVersion);
  }

  const followingVisible = tab === "following";
  // Takip Edilenler'de misafire ya da akış kurulmadıysa panelde gösterilecek ilan yok
  const followingReady = Boolean(session) && followingKey !== null;
  const panelVehicle = followingVisible ? (followingReady ? activeByTab.following : isLoading ? undefined : null) : activeByTab.explore;

  return (
    <FeedPanelContext.Provider value={panel}>
      <div className="flex h-full w-full">
        {/* Video sütunu: mobilde ekranın tamamı */}
        <div className="relative h-full min-w-0 flex-1">
          <div
            id={PANEL_IDS.explore}
            role="tabpanel"
            aria-labelledby="feed-tab-explore"
            inert={followingVisible}
            className={`absolute inset-0 ${followingVisible ? "invisible" : ""}`}
          >
            <VideoFeed
              key={initialVehicleId ?? "feed"}
              initialVehicleId={initialVehicleId}
              visible={!followingVisible}
              muted={muted}
              onMutedChange={setMuted}
              onActiveVehicleChange={onExploreActive}
              wheelNavigation={isDesktop}
            />
          </div>

          <div
            id={PANEL_IDS.following}
            role="tabpanel"
            aria-labelledby="feed-tab-following"
            inert={!followingVisible}
            className={`absolute inset-0 bg-[#121212] ${followingVisible ? "" : "invisible"}`}
          >
            {isLoading ? null : !session ? (
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
                  muted={muted}
                  onMutedChange={setMuted}
                  onActiveVehicleChange={onFollowingActive}
                  wheelNavigation={isDesktop}
                  emptyState={
                    <FollowingEmpty
                      kind={profile && profile.followingCount > 0 ? "quiet" : "none"}
                      onExplore={() => selectTab("explore")}
                    />
                  }
                />
              )
            )}
          </div>

          <FeedHeader center={<FeedTabs active={tab} onChange={selectTab} panelIds={PANEL_IDS} />} actionsInPanel />
        </div>

        {/* Masaüstü yan panel: yerleşim ve üst çubuk CSS'le baştan çizilir; veri
            isteyen içerik yalnızca masaüstünde kurulur (mobilde istek atılmaz) */}
        <aside
          aria-label="İlan ayrıntıları ve yorumlar"
          data-feed-keys="off"
          className="hidden h-full w-[380px] shrink-0 flex-col border-l border-[#27272A] bg-[#121212] text-white lg:flex xl:w-[420px] 2xl:w-[460px]"
        >
          <PanelToolbar />
          {isDesktop && <DesktopFeedPanel vehicle={panelVehicle} focusRequest={focusRequest} />}
        </aside>
      </div>

      {showAuth &&
        createPortal(
          <AuthModalPortal
            onClose={() => setShowAuth(false)}
            onAuthenticated={() => setShowAuth(false)}
            oauthReturnTo="/?feed=following"
          />,
          document.body,
        )}
    </FeedPanelContext.Provider>
  );
}
