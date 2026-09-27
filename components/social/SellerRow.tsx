"use client";

import Link from "next/link";
import { useSellerProfile } from "../../lib/use-follow";
import { profilePath } from "../../lib/username";
import Avatar from "../ui/Avatar";
import FollowButton from "./FollowButton";

// Akış kartında satıcı: avatar ve @kullanıcı_adı (vitrine gider) ile "Takip et".
// Satıcının kısa profili akışa gelen sayfalarla birlikte toplu istenir
// (primeSellerProfiles); gelene kadar satır çizilmez, kart kaymaz diye yer tutulmaz.
export default function SellerRow({ sellerId }: { sellerId: string | null }) {
  const seller = useSellerProfile(sellerId);
  if (!seller) return null;

  // Akışta TikTok gibi @kullanıcı_adı; yoksa görünen ad, o da yoksa "Satıcı"
  const label = seller.username ? `@${seller.username}` : (seller.displayName ?? "Satıcı");
  const identity = (
    <>
      <Avatar url={seller.avatarUrl} name={seller.displayName ?? seller.username} size={32} className="ring-2 ring-white/85" />
      <span className="truncate text-[15px] font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{label}</span>
    </>
  );

  return (
    <div className="mb-3 flex max-w-full flex-wrap items-center gap-x-2.5 gap-y-1 motion-safe:animate-[fade-in_200ms_ease-out]">
      {seller.username ? (
        <Link
          href={profilePath(seller.username)}
          aria-label={`${label} vitrini`}
          className="pointer-events-auto flex min-w-0 max-w-[65%] items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {identity}
        </Link>
      ) : (
        <span className="flex min-w-0 max-w-[65%] items-center gap-2">{identity}</span>
      )}
      <FollowButton userId={seller.id} variant="overlay" name={label} />
    </div>
  );
}
