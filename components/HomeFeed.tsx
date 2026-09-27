"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { AuthModalPortal } from "./AuthGatedLink";
import FeedHeader from "./FeedHeader";
import VideoFeed from "./VideoFeed";
import FeedTabs, { type FeedTab } from "./social/FeedTabs";
import FollowingEmpty from "./social/FollowingEmpty";
import { useSupabaseSession } from "../lib/auth";
import { useFollowVersion } from "../lib/use-follow";
import { useMyProfile } from "../lib/use-my-profile";

const PANEL_IDS: Record<FeedTab, string> = { following: "feed-panel-following", explore: "feed-panel-explore" };

// Ana sayfa: "Keşfet" (bütün yayındaki ilanlar) ve "Takip Edilenler" (takip
// edilen satıcıların videoları). Sekme değişince diğer akış silinmez, gizlenir:
// Keşfet'e dönülünce kalınan yerden devam edilir. "Takip Edilenler" ilk kez
// açılınca kurulur; bu arada biri takip edilir ya da bırakılırsa yeniden kurulur.
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

  function selectTab(next: FeedTab) {
    setTab(next);
    if (next === "following" && followingKey !== followVersion) setFollowingKey(followVersion);
  }

  const followingVisible = tab === "following";

  return (
    <>
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
        />
      </div>

      <div
        id={PANEL_IDS.following}
        role="tabpanel"
        aria-labelledby="feed-tab-following"
        inert={!followingVisible}
        className={`absolute inset-0 bg-black ${followingVisible ? "" : "invisible"}`}
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

      <FeedHeader center={<FeedTabs active={tab} onChange={selectTab} panelIds={PANEL_IDS} />} />

      {showAuth &&
        createPortal(
          <AuthModalPortal
            onClose={() => setShowAuth(false)}
            onAuthenticated={() => setShowAuth(false)}
            oauthReturnTo="/?feed=following"
          />,
          document.body,
        )}
    </>
  );
}
