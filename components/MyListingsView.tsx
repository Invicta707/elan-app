"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import AuthModal from "./AuthModal";
import FeedHeader from "./FeedHeader";
import { useSupabaseSession } from "../lib/auth";
import {
  STATUS_LABELS,
  statusActions,
  type StatusAction,
  type VehicleStatus,
} from "../lib/listing-status";
import { fetchMyListings, updateListingStatus, type MyListing } from "../lib/my-listings";
import { currencySymbol, formatAmount } from "../lib/search";

export default function MyListingsView() {
  const { session, isLoading } = useSupabaseSession();
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <>
      <FeedHeader activeTab="my-listings" tone="solid" />
      <div className="mx-auto max-w-2xl px-4 pt-2 pb-[max(2.5rem,calc(var(--bottom-nav-height)+1.5rem),env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[26px] font-semibold [font-family:var(--font-display)]">İlanlarım</h1>
          {/* Çıkış ve hesap silme */}
          <Link
            href="/account"
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-[#C9CED6] bg-white px-3.5 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            <UserIcon className="h-4 w-4" />
            Hesabım
          </Link>
        </div>

        {isLoading ? (
          <ListSkeleton />
        ) : session ? (
          // Kullanıcı değişince liste sıfırdan kurulur
          <ListingList key={session.user.id} sellerId={session.user.id} />
        ) : (
          <div className="mt-10 flex flex-col items-center gap-4 text-center">
            <p className="text-[15px] text-[#5B616B]">İlanlarını görmek için giriş yap.</p>
            <button
              type="button"
              onClick={() => setShowAuthModal(true)}
              className="h-12 rounded-md bg-[#003399] px-6 text-[16px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
            >
              Giriş yap
            </button>
          </div>
        )}
      </div>

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onAuthenticated={() => setShowAuthModal(false)}
        />
      )}
    </>
  );
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; listings: MyListing[] };

function ListingList({ sellerId }: { sellerId: string }) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    fetchMyListings(sellerId)
      .then((listings) => {
        if (active) setLoad({ status: "ready", listings });
      })
      .catch((error) => {
        console.error("İlanlar yüklenemedi:", error);
        if (active) setLoad({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [sellerId, reloadKey]);

  function updateStatus(id: string, status: VehicleStatus) {
    setLoad((current) =>
      current.status === "ready"
        ? { ...current, listings: current.listings.map((l) => (l.id === id ? { ...l, status } : l)) }
        : current,
    );
  }

  if (load.status === "loading") return <ListSkeleton />;

  if (load.status === "error") {
    return (
      <div role="status" className="mt-10 flex flex-col items-center gap-4 text-center">
        <p className="text-[15px] text-[#5B616B]">İlanların yüklenemedi.</p>
        <button
          type="button"
          onClick={() => {
            setLoad({ status: "loading" });
            setReloadKey((k) => k + 1);
          }}
          className="rounded-md border border-[#15181C] bg-white px-5 py-2.5 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
        >
          Tekrar dene
        </button>
      </div>
    );
  }

  if (load.listings.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-center gap-4 text-center">
        <p className="text-[15px] text-[#5B616B]">Henüz bir ilanın yok.</p>
        <Link
          href="/sell"
          className="h-12 rounded-md bg-[#003399] px-6 text-[16px] font-semibold leading-[3rem] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
        >
          İlan ver
        </Link>
      </div>
    );
  }

  return (
    <ul className="mt-4 flex flex-col gap-3">
      {load.listings.map((listing) => (
        <li key={listing.id}>
          <ListingCard listing={listing} onStatusChanged={(status) => updateStatus(listing.id, status)} />
        </li>
      ))}
    </ul>
  );
}

const STATUS_BADGE: Record<VehicleStatus, string> = {
  active: "bg-[#E6F6EC] text-[#1B7A3D]",
  pending_video: "bg-[#FEF6E7] text-[#8A6116]",
  draft: "bg-[#FEF6E7] text-[#8A6116]",
  sold: "bg-[#EAEFF7] text-[#003399]",
  archived: "bg-[#EEF0F3] text-[#5B616B]",
};

const ACTION_TONE: Record<StatusAction["tone"], string> = {
  primary: "bg-[#003399] text-white",
  neutral: "border border-[#C9CED6] bg-white text-[#15181C]",
  danger: "border border-[#C4282E] bg-white text-[#C4282E]",
};

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" });

function ListingCard({
  listing,
  onStatusChanged,
}: {
  listing: MyListing;
  onStatusChanged: (status: VehicleStatus) => void;
}) {
  const [pending, setPending] = useState<VehicleStatus | null>(null);
  const [confirming, setConfirming] = useState<StatusAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function apply(action: StatusAction) {
    setConfirming(null);
    setError(null);
    setPending(action.target);
    try {
      onStatusChanged(await updateListingStatus(listing.id, action.target));
    } catch (err) {
      setError(err instanceof Error ? err.message : "İlan durumu güncellenemedi.");
    } finally {
      setPending(null);
    }
  }

  const actions = statusActions(listing.status);

  return (
    <article className="rounded-lg border border-[#E3E6EA] bg-white p-3">
      <div className="flex gap-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md bg-[#E6E8EB]">
          {listing.coverUrl ? (
            <Image src={listing.coverUrl} alt="" fill sizes="80px" className="object-cover" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-[11px] text-[#8A9099]">
              Görsel yok
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="truncate text-[18px] font-semibold leading-tight [font-family:var(--font-display)]">
              {listing.title}
            </h2>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold ${STATUS_BADGE[listing.status]}`}
            >
              {STATUS_LABELS[listing.status]}
            </span>
          </div>
          <p className="mt-0.5 text-[16px] font-extrabold tabular-nums [font-family:var(--font-display)]">
            {currencySymbol(listing.currency)}
            {formatAmount(listing.price)}
          </p>
          <p className="mt-0.5 text-[13px] text-[#5B616B]">
            {listing.year} · {formatAmount(listing.mileageKm)} km
            {listing.city ? ` · ${listing.city}` : ""}
          </p>
          <p className="mt-0.5 text-[12px] text-[#8A9099]">
            {dateFormatter.format(new Date(listing.createdAt))}
          </p>
        </div>
      </div>

      <div role="status" aria-live="polite">
        {error && <p className="mt-2 rounded-md bg-[#FDEDEC] px-3 py-2 text-[13px] text-[#B42318]">{error}</p>}
      </div>

      {confirming ? (
        <div className="mt-3 rounded-md bg-[#FDEDEC] p-3">
          <p className="text-[14px] text-[#15181C]">{confirming.confirm}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => apply(confirming)}
              className="h-10 flex-1 rounded-md bg-[#C4282E] text-[14px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C4282E] focus-visible:ring-offset-2"
            >
              Evet, işaretle
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="h-10 flex-1 rounded-md border border-[#C9CED6] bg-white text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
            >
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        (actions.length > 0 || listing.status === "active") && (
          <div className="mt-3 flex flex-wrap gap-2">
            {actions.map((action) => (
              <button
                key={action.target}
                type="button"
                disabled={pending !== null}
                aria-busy={pending === action.target}
                onClick={() => (action.confirm ? setConfirming(action) : apply(action))}
                className={`h-10 rounded-md px-3 text-[14px] font-semibold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2 ${ACTION_TONE[action.tone]}`}
              >
                {pending === action.target ? "Kaydediliyor…" : action.label}
              </button>
            ))}
            {listing.status === "active" && listing.hasPlayableVideo && (
              <Link
                href={`/?v=${listing.id}`}
                className="flex h-10 items-center rounded-md px-3 text-[14px] font-semibold text-[#003399] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
              >
                Akışta gör
              </Link>
            )}
          </div>
        )
      )}
    </article>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden="true" className="mt-4 flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-lg bg-[#E6E8EB] motion-reduce:animate-none" />
      ))}
    </div>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
