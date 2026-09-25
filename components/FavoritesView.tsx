"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AuthModal from "./AuthModal";
import FavoriteButton from "./FavoriteButton";
import FeedHeader from "./FeedHeader";
import VehicleGridCard from "./VehicleGridCard";
import { fetchFavoriteVehicles } from "../lib/favorites";
import type { VehicleCardData } from "../lib/search";
import { removeFavorites, retryFavorites, useFavorites } from "../lib/use-favorites";

export default function FavoritesView() {
  const { status, userId, ids } = useFavorites();
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <>
      <FeedHeader activeTab="favorites" tone="solid" />
      <div className="mx-auto max-w-5xl px-4 pt-2 pb-[max(2.5rem,calc(var(--bottom-nav-height)+1.5rem),env(safe-area-inset-bottom))]">
        <h1 className="text-[26px] font-semibold [font-family:var(--font-display)]">Favorilerim</h1>

        {status === "ready" && userId === null && (
          <p className="mt-1 text-[14px] text-[#5B616B]">
            Favorilerin bu cihazda saklanıyor.{" "}
            <button
              type="button"
              onClick={() => setShowAuthModal(true)}
              className="rounded-sm font-semibold text-[#003399] underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
            >
              Giriş yap
            </button>
            , tüm cihazlarında gör.
          </p>
        )}

        {status === "loading" ? (
          <GridSkeleton />
        ) : status === "error" ? (
          <Message
            text="Favorilerin yüklenemedi."
            action={{ label: "Tekrar dene", onClick: () => void retryFavorites() }}
          />
        ) : ids.length === 0 ? (
          <EmptyState />
        ) : (
          <FavoritesGrid ids={ids} />
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

// ilan id'si → kart; null: artık yayında değil (satılmış, kaldırılmış ya da silinmiş)
type CardCache = ReadonlyMap<string, VehicleCardData | null>;

function FavoritesGrid({ ids }: { ids: readonly string[] }) {
  const [cards, setCards] = useState<CardCache>(new Map());
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Sadece henüz bilinmeyen ilanlar sorgulanır: favoriden çıkarmak yeniden
  // yükleme gerektirmez, başka sekmede eklenen ilan ise listeye eklenir
  const unknownKey = ids.filter((id) => !cards.has(id)).join(",");

  useEffect(() => {
    if (!unknownKey) return;
    let active = true;
    const wanted = unknownKey.split(",");

    fetchFavoriteVehicles(wanted)
      .then((found) => {
        if (!active) return;
        setLoadFailed(false);
        setCards((previous) => {
          const next = new Map(previous);
          for (const id of wanted) next.set(id, null);
          for (const card of found) next.set(card.id, card);
          return next;
        });
      })
      .catch((error) => {
        console.error("Favori ilanlar yüklenemedi:", error);
        if (active) setLoadFailed(true);
      });

    return () => {
      active = false;
    };
  }, [unknownKey, reloadKey]);

  const visible = ids.flatMap((id) => cards.get(id) ?? []);
  const unavailable = ids.filter((id) => cards.get(id) === null);

  if (loadFailed && visible.length === 0) {
    return (
      <Message
        text="Favori ilanların yüklenemedi."
        action={{ label: "Tekrar dene", onClick: () => setReloadKey((key) => key + 1) }}
      />
    );
  }

  if (visible.length === 0 && unavailable.length === 0) return <GridSkeleton />;

  return (
    <>
      {unavailable.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg bg-white px-4 py-3 text-[14px] text-[#4A5058]">
          <span>
            {unavailable.length === 1
              ? "Favorilerindeki 1 ilan artık yayında değil."
              : `Favorilerindeki ${unavailable.length} ilan artık yayında değil.`}
          </span>
          <button
            type="button"
            onClick={() => void removeFavorites(unavailable)}
            className="rounded-md px-2 py-1 font-semibold text-[#003399] underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            Listeden kaldır
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3 lg:grid-cols-4">
          {visible.map((vehicle, index) => (
            <li key={vehicle.id}>
              <VehicleGridCard
                vehicle={vehicle}
                eager={index < 4}
                action={<FavoriteButton vehicleId={vehicle.id} variant="card" />}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function EmptyState() {
  return (
    <div className="mt-10 flex flex-col items-center gap-4 text-center">
      <p className="max-w-xs text-[15px] text-[#5B616B]">
        Henüz favori ilanın yok. Beğendiğin ilanlardaki kalbe dokunarak buraya ekleyebilirsin.
      </p>
      <Link
        href="/search"
        className="h-12 rounded-md bg-[#003399] px-6 text-[16px] font-semibold leading-[3rem] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
      >
        İlanlara göz at
      </Link>
    </div>
  );
}

function Message({ text, action }: { text: string; action: { label: string; onClick: () => void } }) {
  return (
    <div role="status" className="mt-10 flex flex-col items-center gap-4 text-center">
      <p className="text-[15px] text-[#5B616B]">{text}</p>
      <button
        type="button"
        onClick={action.onClick}
        className="rounded-md border border-[#15181C] bg-white px-5 py-2.5 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
      >
        {action.label}
      </button>
    </div>
  );
}

function GridSkeleton() {
  return (
    <ul aria-hidden="true" className="mt-5 grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <li key={index}>
          <div className="aspect-[4/5] animate-pulse rounded-lg bg-[#DDE1E6]" />
          <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-[#DDE1E6]" />
          <div className="mt-1.5 h-3 w-1/2 animate-pulse rounded bg-[#DDE1E6]" />
        </li>
      ))}
    </ul>
  );
}
