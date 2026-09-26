"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { useSupabaseSession } from "../../lib/auth";
import type { SellerProfile } from "../../lib/follows";
import { DEFAULT_MEMBER_NAME } from "../../lib/messages";
import { primeSellerProfiles } from "../../lib/use-follow";
import { profilePath } from "../../lib/username";
import Avatar from "../ui/Avatar";
import FollowButton from "./FollowButton";

// İlan sayfasında satıcı: avatar, ad, @kullanıcı_adı (vitrine gider) ve takip.
// Sunucu kartı anonim çizer; takip durumu tarayıcıda oturumla okunur.
export default function SellerCard({ seller }: { seller: SellerProfile }) {
  const { session } = useSupabaseSession();
  const viewerId = session?.user.id ?? null;

  useEffect(() => {
    if (viewerId) void primeSellerProfiles([seller.id]);
  }, [viewerId, seller.id]);

  const name = seller.displayName ?? (seller.username ? `@${seller.username}` : DEFAULT_MEMBER_NAME);
  const identity = (
    <>
      <Avatar url={seller.avatarUrl} name={seller.displayName ?? seller.username} size={48} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold">{name}</span>
        {seller.username && (
          <span className="flex items-center gap-0.5 text-[13.5px] font-medium text-[#5B616B]">
            <span className="truncate">{seller.displayName ? `@${seller.username} · ` : ""}Vitrini gör</span>
            <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
          </span>
        )}
      </span>
    </>
  );

  return (
    <section aria-label="Satıcı" className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
      {seller.username ? (
        <Link
          href={profilePath(seller.username)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
        >
          {identity}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{identity}</div>
      )}
      <FollowButton userId={seller.id} variant="compact" name={name} />
    </section>
  );
}
