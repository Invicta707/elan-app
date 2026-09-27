"use client";

import { EyeOff, Hourglass, MoreHorizontal, Play, ShieldAlert } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { MyListing } from "../../lib/my-listings";
import { formatCount, formatTilePrice, isContentRejected, isLive, tileBadge } from "../../lib/showcase";

// Vitrinim ızgarasının dikey karesi (Reels / TikTok profili gibi): video
// kapağı, sol altta cam efektli fiyat, sağ altta görüntülenme. Yayındaki ilan
// ilan sayfasına gider; yayında olmayanın herkese açık sayfası yoktur, dokununca
// yönetim menüsü açılır.
export default function ShowcaseTile({
  listing,
  onManage,
  priority = false,
}: {
  listing: MyListing;
  /** Yönetim menüsü (Vitrinim). Verilmezse (herkese açık profil) köşe menüsü çizilmez. */
  onManage?: (listing: MyListing) => void;
  priority?: boolean;
}) {
  const live = isLive(listing.status);
  const price = formatTilePrice(listing.price, listing.currency);
  const views = formatCount(listing.viewsCount);
  const badge = tileBadge(listing);
  const rejected = isContentRejected(listing);
  const BadgeIcon = rejected ? ShieldAlert : listing.status === "pending_moderation" ? Hourglass : EyeOff;
  const label = `${listing.title} ${listing.year}, ${price}, ${listing.viewsCount} görüntülenme${badge ? `, ${badge.toLocaleLowerCase("tr")}` : ""}`;

  const body = (
    <>
      {listing.posterUrl ? (
        <Image
          src={listing.posterUrl}
          alt=""
          fill
          priority={priority}
          sizes="(min-width: 672px) 224px, 33vw"
          className={`object-cover transition-[filter] duration-200 ${live ? "" : "brightness-[0.55] saturate-[0.7]"}`}
        />
      ) : (
        // Reddedilen ilanın medyası silinir: ortada yalnızca etiket kalır
        !badge && (
          <span className="absolute inset-0 flex items-center justify-center text-[12px] font-medium text-white/60">
            Kapak yok
          </span>
        )
      )}

      {/* Alt kenarda okunabilirlik için hafif karartma */}
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent" />

      {/* Pasif ilan: kararmış karenin ortasında etiket (köşedeki menüyle çakışmaz).
          İçerik denetimi: "İnceleniyor" / "Yayınlanmadı" */}
      {badge && (
        <span className="absolute inset-x-1 top-1/2 flex -translate-y-1/2 justify-center">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-white backdrop-blur-md ${rejected ? "bg-[#B42318]/85" : "bg-black/55"}`}
          >
            <BadgeIcon aria-hidden="true" className="h-3 w-3" />
            {badge}
          </span>
        </span>
      )}

      {/* Fiyat sol altta, görüntülenme sağ altta. Dar karede görüntülenme fiyatın üstüne
          çıkar: fiyat hiç kesilmez (kare bir @container) */}
      <span className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-full border border-white/15 bg-black/35 px-2 py-[3px] text-[11.5px] font-bold tabular-nums text-white backdrop-blur-md">
        {price}
      </span>
      <span className="absolute right-1.5 bottom-[30px] inline-flex items-center gap-0.5 text-[11.5px] font-semibold tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)] @[10rem]:bottom-2">
        <Play aria-hidden="true" className="h-3 w-3 fill-current" />
        {views}
      </span>
    </>
  );

  const surface =
    "@container relative block aspect-[9/16] w-full overflow-hidden rounded-[10px] bg-[#1C1F24] transition-transform duration-150 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2";

  return (
    <div className="relative">
      {live || !onManage ? (
        <Link href={`/vehicles/${listing.id}`} aria-label={label} className={surface}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={() => onManage(listing)} aria-label={`${label}. Yönet`} className={`${surface} text-left`}>
          {body}
        </button>
      )}
      {onManage && (
        <button
          type="button"
          onClick={() => onManage(listing)}
          aria-label={`${listing.title} ilanını yönet`}
          className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-md transition-transform active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
