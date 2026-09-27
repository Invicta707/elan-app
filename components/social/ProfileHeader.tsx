"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSupabaseSession } from "../../lib/auth";
import { fetchProfilePage, type ProfilePageData } from "../../lib/follows";
import { formatCount } from "../../lib/showcase";
import { seedFollowState, useFollow } from "../../lib/use-follow";
import { profilePath } from "../../lib/username";
import Avatar from "../ui/Avatar";
import ShareButton from "../vehicle/ShareButton";
import FollowButton from "./FollowButton";
import MessageUserButton from "./MessageUserButton";

// /@kullanici_adi başlığı: avatar, ad, @kullanıcı_adı, İlan | Takipçi | Takip
// Edilen, Takip Et / Takibi Bırak ve Mesaj (kendi profilinde Profili Düzenle).
// Sunucu sayfayı anonim çizer; oturum varsa profil tarayıcıda yeniden okunur
// (takip durumu, "kendi profilim mi", güncel sayılar).
export default function ProfileHeader({ initial }: { initial: ProfilePageData }) {
  const { session } = useSupabaseSession();
  const viewerId = session?.user.id ?? null;
  const [profile, setProfile] = useState(initial);

  useEffect(() => {
    if (!viewerId) return;
    let active = true;
    fetchProfilePage(initial.username)
      .then((fresh) => {
        if (!active || !fresh) return;
        setProfile(fresh);
        seedFollowState(viewerId, fresh.id, fresh.isFollowing, fresh.followersCount);
      })
      .catch((error) => console.error("Profil yenilenemedi:", error));
    return () => {
      active = false;
    };
  }, [viewerId, initial.username]);

  const follow = useFollow(profile.id, profile.followersCount);
  const isMe = profile.isMe || follow.isSelf;
  const name = profile.displayName ?? `@${profile.username}`;

  return (
    <section aria-label="Profil" className="flex flex-col items-center px-1 pt-2 text-center">
      <Avatar
        url={profile.avatarUrl}
        name={profile.displayName ?? profile.username}
        size={96}
        className="shadow-[0_4px_16px_rgba(16,24,40,0.12)] ring-4 ring-white"
      />
      <h1 className="mt-3 max-w-full truncate text-[22px] font-semibold leading-tight [font-family:var(--font-display)]">{name}</h1>
      {profile.displayName && <p className="mt-0.5 text-[15px] font-medium text-[#5B616B]">@{profile.username}</p>}

      <ProfileStats listings={profile.listingsCount} followers={follow.followers ?? profile.followersCount} following={profile.followingCount} />

      <div className="mt-4 flex w-full max-w-sm flex-wrap items-center justify-center gap-2">
        {isMe ? (
          <Link
            href="/my-listings"
            className="inline-flex h-12 min-w-[9.5rem] flex-1 items-center justify-center gap-2 rounded-xl bg-[#E9ECEF] px-6 text-[15px] font-semibold text-[#15181C] transition-transform hover:bg-[#DDE1E6] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/30"
          >
            <Pencil aria-hidden="true" className="h-4 w-4" />
            Profili Düzenle
          </Link>
        ) : (
          <>
            <FollowButton userId={profile.id} variant="profile" name={name} className="flex-1" />
            <MessageUserButton userId={profile.id} name={name} className="flex-1" />
          </>
        )}
        <ShareButton
          path={profilePath(profile.username)}
          label="Profili paylaş"
          title={`${name} | gözüyle`}
          text={`${name} adlı satıcının vitrini gözüyle'de:`}
          variant="icon"
        />
      </div>
    </section>
  );
}

/** İlan | Takipçi | Takip Edilen: aralarında ince çizgi, sayı kalın */
export function ProfileStats({ listings, followers, following }: { listings: number; followers: number; following: number }) {
  const items: [string, number][] = [
    ["İlan", listings],
    ["Takipçi", followers],
    ["Takip Edilen", following],
  ];
  return (
    <dl className="mt-4 flex w-full max-w-sm items-stretch justify-center divide-x divide-[#DDE1E6]">
      {items.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-1 flex-col-reverse items-center px-2">
          <dt className="mt-0.5 text-[13px] font-medium text-[#5B616B]">{label}</dt>
          <dd className="text-[19px] font-bold tabular-nums leading-tight">{formatCount(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
