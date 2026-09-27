"use client";

import { ArrowUpRight, AtSign, Clapperboard, MessageCircle, Pencil, Settings } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import AuthModal from "../AuthModal";
import FeedHeader from "../FeedHeader";
import { useSupabaseSession } from "../../lib/auth";
import type { VehicleStatus } from "../../lib/listing-status";
import { fetchMyListings, type MyListing } from "../../lib/my-listings";
import { suggestedDisplayName } from "../../lib/profile";
import { formatCount, showcaseStats } from "../../lib/showcase";
import { useMyProfile } from "../../lib/use-my-profile";
import { useUnreadCount } from "../../lib/use-unread-count";
import { profilePath, suggestUsername } from "../../lib/username";
import AvatarPicker from "../profile/AvatarPicker";
import EditNameSheet from "../profile/EditNameSheet";
import UsernameSheet from "../profile/UsernameSheet";
import UnreadBadge from "../ui/UnreadBadge";
import ListingManageSheet from "./ListingManageSheet";
import ShowcaseTile from "./ShowcaseTile";

// /my-listings: "Vitrinim". Profil (avatar, ad, sayılar) ve ilanların
// Reels / TikTok profili gibi 3 sütunlu dikey ızgarası.
export default function ShowcaseView() {
  const { session, isLoading } = useSupabaseSession();
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <>
      <FeedHeader activeTab="my-listings" tone="solid" />
      <div className="mx-auto max-w-2xl px-3 pt-1 pb-[max(2.5rem,calc(var(--bottom-nav-height)+1.5rem),env(safe-area-inset-bottom))] sm:px-4">
        {isLoading ? (
          <ProfileSkeleton />
        ) : session ? (
          <Showcase
            key={session.user.id}
            userId={session.user.id}
            email={session.user.email ?? null}
            metadata={session.user.user_metadata}
          />
        ) : (
          <div className="mt-16 flex flex-col items-center gap-4 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#EAEFF7] text-[#003399]">
              <Clapperboard aria-hidden="true" className="h-7 w-7" />
            </span>
            <h1 className="text-[24px] font-semibold [font-family:var(--font-display)]">Vitrinim</h1>
            <p className="max-w-xs text-[15px] text-[#5B616B]">İlanlarını, mesajlarını ve profilini görmek için giriş yap.</p>
            <button
              type="button"
              onClick={() => setShowAuthModal(true)}
              className="h-12 rounded-2xl bg-[#003399] px-7 text-[16px] font-semibold text-white transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/30"
            >
              Giriş yap
            </button>
          </div>
        )}
      </div>

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} onAuthenticated={() => setShowAuthModal(false)} />
      )}
    </>
  );
}

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; listings: MyListing[] };

function Showcase({
  userId,
  email,
  metadata,
}: {
  userId: string;
  email: string | null;
  metadata: Record<string, unknown> | undefined;
}) {
  const { profile } = useMyProfile();
  const unread = useUnreadCount();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [managing, setManaging] = useState<MyListing | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editingUsername, setEditingUsername] = useState(false);

  useEffect(() => {
    let active = true;
    fetchMyListings(userId)
      .then((listings) => active && setLoad({ status: "ready", listings }))
      .catch((error) => {
        console.error("Vitrin yüklenemedi:", error);
        if (active) setLoad({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [userId, reloadKey]);

  function updateStatus(id: string, status: VehicleStatus) {
    setLoad((current) =>
      current.status === "ready"
        ? { ...current, listings: current.listings.map((l) => (l.id === id ? { ...l, status } : l)) }
        : current,
    );
  }

  const name = profile?.displayName ?? null;
  const username = profile?.username ?? null;
  const listings = load.status === "ready" ? load.listings : [];
  const stats = showcaseStats(listings);

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-1">
        <h1 className="text-[24px] font-semibold leading-tight [font-family:var(--font-display)]">Vitrinim</h1>
        <div className="flex items-center gap-1">
          <Link
            href="/messages"
            aria-label="Mesajlar"
            className="relative flex h-11 w-11 items-center justify-center rounded-full text-[#15181C] transition-transform hover:bg-black/5 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            <MessageCircle aria-hidden="true" className="h-6 w-6" />
            <UnreadBadge count={unread} className="absolute right-0.5 top-0.5" />
          </Link>
          <Link
            href="/settings"
            aria-label="Ayarlar"
            className="flex h-11 w-11 items-center justify-center rounded-full text-[#15181C] transition-transform hover:bg-black/5 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            <Settings aria-hidden="true" className="h-6 w-6" />
          </Link>
        </div>
      </div>

      <section aria-label="Profil" className="mt-3 flex items-center gap-5 px-1">
        <AvatarPicker avatarUrl={profile?.avatarUrl ?? null} name={name} />
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <button
            type="button"
            onClick={() => setEditingName(true)}
            className="group flex max-w-full items-center gap-1.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            <span className={`truncate text-[19px] font-semibold ${name ? "text-[#15181C]" : "text-[#8A9099]"}`}>
              {name ?? "Adını ekle"}
            </span>
            <Pencil aria-hidden="true" className="h-4 w-4 shrink-0 text-[#8A9099] group-hover:text-[#15181C]" />
            <span className="sr-only">Görünen adı düzenle</span>
          </button>

          {username ? (
            <>
              <button
                type="button"
                onClick={() => setEditingUsername(true)}
                className="group mt-0.5 flex max-w-full items-center gap-1 rounded-lg text-left text-[15px] font-medium text-[#5B616B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
              >
                <span className="truncate">@{username}</span>
                <Pencil aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#8A9099] group-hover:text-[#15181C]" />
                <span className="sr-only">Kullanıcı adını değiştir</span>
              </button>
              <Link
                href={profilePath(username)}
                className="mt-2 inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-[#003399] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
              >
                Herkese açık vitrinim
                <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            </>
          ) : (
            profile && (
              <button
                type="button"
                onClick={() => setEditingUsername(true)}
                className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-full bg-[#EAEFF7] px-3.5 text-[13.5px] font-semibold text-[#003399] transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
              >
                <AtSign aria-hidden="true" className="h-4 w-4" />
                Kullanıcı adı belirle
              </button>
            )
          )}
        </div>
      </section>

      <dl className="mt-4 grid grid-cols-4 gap-1.5 px-1 text-center sm:gap-2">
        {[
          ["İlan", stats.total],
          ["Takipçi", profile?.followersCount ?? 0],
          ["Takip", profile?.followingCount ?? 0],
          ["İzlenme", stats.views],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col-reverse rounded-2xl bg-white px-1 py-2 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
            <dt className="mt-1 text-[12px] font-medium text-[#5B616B]">{label}</dt>
            <dd className="text-[17px] font-bold tabular-nums leading-none">{formatCount(Number(value))}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 grid grid-cols-2 gap-2 px-1">
        <Link
          href="/sell"
          className="flex h-11 items-center justify-center rounded-xl bg-[#003399] text-[15px] font-semibold text-white transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/30"
        >
          İlan ver
        </Link>
        <Link
          href="/messages"
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-white text-[15px] font-semibold text-[#15181C] shadow-[0_1px_2px_rgba(16,24,40,0.08)] transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
        >
          Mesajlar
          <UnreadBadge count={unread} />
        </Link>
      </div>

      <h2 className="mt-6 mb-2 flex items-center gap-2 px-1 text-[14px] font-semibold text-[#5B616B]">
        <Clapperboard aria-hidden="true" className="h-4 w-4" />
        İlanlar
        {stats.total > 0 && <span className="font-medium text-[#8A9099]">· {stats.live} yayında</span>}
      </h2>

      {load.status === "loading" ? (
        <GridSkeleton />
      ) : load.status === "error" ? (
        <div role="status" className="mt-8 flex flex-col items-center gap-3 text-center">
          <p className="text-[15px] text-[#5B616B]">Vitrinin yüklenemedi.</p>
          <button
            type="button"
            onClick={() => {
              setLoad({ status: "loading" });
              setReloadKey((k) => k + 1);
            }}
            className="h-11 rounded-xl bg-white px-5 text-[15px] font-semibold shadow-[0_1px_2px_rgba(16,24,40,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            Tekrar dene
          </button>
        </div>
      ) : listings.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-[#D5D9DF] px-6 py-10 text-center">
          <Clapperboard aria-hidden="true" className="h-8 w-8 text-[#8A9099]" />
          <p className="text-[16px] font-semibold">Vitrinin henüz boş</p>
          <p className="max-w-xs text-[14px] text-[#5B616B]">Aracının dikey videosunu yükle; ilk ilanın burada görünsün.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-1 sm:gap-1.5">
          {listings.map((listing, index) => (
            <li key={listing.id}>
              <ShowcaseTile listing={listing} onManage={setManaging} priority={index < 6} />
            </li>
          ))}
        </ul>
      )}

      {managing && (
        <ListingManageSheet
          listing={managing}
          onClose={() => setManaging(null)}
          onStatusChanged={(status) => updateStatus(managing.id, status)}
        />
      )}
      {editingUsername && (
        <UsernameSheet
          mode={username ? "edit" : "onboarding"}
          initialValue={username ?? suggestUsername(name ?? suggestedDisplayName(metadata), email)}
          onClose={() => setEditingUsername(false)}
        />
      )}
      {editingName && (
        <EditNameSheet
          initialName={name ?? suggestedDisplayName(metadata)}
          onClose={() => setEditingName(false)}
        />
      )}
    </>
  );
}

function ProfileSkeleton() {
  return (
    <div aria-hidden="true" className="motion-safe:animate-pulse">
      <div className="mt-3 flex items-center gap-5 px-1">
        <div className="h-[100px] w-[100px] rounded-full bg-[#E3E6EA]" />
        <div className="flex-1 space-y-3">
          <div className="h-5 w-32 rounded bg-[#E3E6EA]" />
          <div className="h-12 rounded-2xl bg-[#E3E6EA]" />
        </div>
      </div>
      <GridSkeleton />
    </div>
  );
}

function GridSkeleton() {
  return (
    <div aria-hidden="true" className="mt-4 grid grid-cols-3 gap-1">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="aspect-[9/16] rounded-[10px] bg-[#E3E6EA] motion-safe:animate-pulse" />
      ))}
    </div>
  );
}
