"use client";

import Link from "next/link";
import { useSellerProfile } from "../../lib/use-follow";
import { profilePath } from "../../lib/username";
import Avatar from "../ui/Avatar";
import FollowButton from "./FollowButton";

// Akış kartında (mobil) satıcı: videonun alt şeridinin en üstünde küçük, yarı
// saydam bir etiket (avatar + @kullanıcı_adı, vitrine gider) ve "Takip et".
// Satıcının kısa profili akışa gelen sayfalarla birlikte toplu istenir
// (primeSellerProfiles); gelene kadar satır çizilmez, kart kaymaz diye yer tutulmaz.
export default function SellerRow({ sellerId }: { sellerId: string | null }) {
  const seller = useSellerProfile(sellerId);
  if (!seller) return null;

  // Akışta TikTok gibi @kullanıcı_adı; yoksa görünen ad, o da yoksa "Satıcı"
  const label = seller.username ? `@${seller.username}` : (seller.displayName ?? "Satıcı");
  const pill =
    "flex min-w-0 max-w-[72%] items-center gap-1.5 rounded-full bg-black/30 py-0.5 pr-2.5 pl-0.5 ring-1 ring-inset ring-white/15 backdrop-blur-[6px]";
  const identity = (
    <>
      <Avatar url={seller.avatarUrl} name={seller.displayName ?? seller.username} size={22} />
      <span className="truncate text-[13px] font-semibold leading-5">{label}</span>
    </>
  );

  return (
    <div className="mb-1.5 flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 motion-safe:animate-[fade-in_200ms_ease-out]">
      {seller.username ? (
        // Etiket küçük; dokunma alanı dikeyde genişletilir (before)
        <Link
          href={profilePath(seller.username)}
          aria-label={`${label} vitrini`}
          className={`pointer-events-auto relative before:absolute before:-inset-y-2 before:inset-x-0 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${pill}`}
        >
          {identity}
        </Link>
      ) : (
        <span className={pill}>{identity}</span>
      )}
      <FollowButton userId={seller.id} variant="overlay" name={label} />
    </div>
  );
}
