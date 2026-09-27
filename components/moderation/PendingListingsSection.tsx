"use client";

import { Eye, EyeOff, Play, RotateCcw } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { REASON_LABELS } from "../../lib/content-moderation";
import { STATUS_LABELS } from "../../lib/listing-status";
import {
  fetchPendingListings,
  formatRelativeTime,
  isSensitiveListing,
  nextReviewId,
  submitListingDecision,
  type ListingDecision,
  type PendingListing,
} from "../../lib/moderation";
import { currencySymbol, formatAmount } from "../../lib/search";
import { adminListingDecided } from "../../lib/use-admin-status";
import ListingReviewer, { type ReviewOutcome } from "./ListingReviewer";

// /admin/reports → "İçerik denetimi": yayına girmeyi bekleyen bütün ilanlar.
// Hiçbir ilan yönetici onayı olmadan yayına girmez: otomatik denetim temiz
// bulduysa ilan "onay bekliyor"dur; şüpheli, denetlenemeyen ya da denetimi
// yarıda kalan ilanlar da burada. Bu ilanlar akışta görünmez; burada onaylanır
// (yayına girer), reddedilir (medya silinir) ya da otomatik denetim yeniden
// çalıştırılır. Yetkiyi /api/admin/listings denetler.
//
// Mobilde asıl yol seri inceleme (ListingReviewer): "İncelemeye başla" ya da
// kartın kapağı videoyu tam ekranda, uygulamanın içinde oynatır; Onayla / Reddet
// sonrası sıradaki ilan gelir. /admin/reports?incele=1 (Vitrinim'deki "İncele")
// liste yüklenince incelemeyi doğrudan açar.

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: PendingListing[] };

/** Seri inceleme: kapalı, bir ilanda ya da liste bitti (id null) */
type Review = { open: false } | { open: true; id: string | null };

const SECONDARY_BUTTON =
  "h-10 shrink-0 rounded-md border border-[#C9CED6] bg-white px-4 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2 disabled:opacity-60";

const AUTO_START_PARAM = "incele";

export default function PendingListingsSection({
  getAccessToken,
  onUnauthorized,
}: {
  getAccessToken: () => Promise<string | null>;
  onUnauthorized: () => void;
}) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [review, setReview] = useState<Review>({ open: false });
  // ?incele=1: liste gelince inceleme bir kez kendiliğinden açılır
  const [autoStart, setAutoStart] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has(AUTO_START_PARAM),
  );

  useEffect(() => {
    let active = true;
    (async () => {
      const token = await getAccessToken();
      const result = token
        ? await fetchPendingListings(token)
        : ({ ok: false, status: 401, message: "" } as const);
      if (!active) return;
      if (result.ok) setLoad({ status: "ready", items: result.items });
      else if (result.status === 401 || result.status === 403) onUnauthorized();
      else setLoad({ status: "error", message: result.message });
    })();
    return () => {
      active = false;
    };
  }, [reloadKey, getAccessToken, onUnauthorized]);

  const items = load.status === "ready" ? load.items : [];

  // Liste gelince bir kez (render sırasında durum ayarı: ek çizim olmaz)
  if (autoStart && load.status === "ready") {
    setAutoStart(false);
    if (items.length > 0) setReview({ open: true, id: items[0].vehicle.id });
  }

  // ?incele=1 adresten kaldırılır: sayfa yenilenince inceleme yeniden açılmaz
  useEffect(() => {
    if (autoStart || !new URLSearchParams(window.location.search).has(AUTO_START_PARAM)) return;
    window.history.replaceState(null, "", window.location.pathname);
  }, [autoStart]);

  function reload(message: string | null = null) {
    setNotice(message);
    setLoad({ status: "loading" });
    setReloadKey((k) => k + 1);
  }

  /** Listeyi arka planda tazeler (seri inceleme açıkken liste boşalmasın) */
  async function refreshQuietly() {
    const token = await getAccessToken();
    if (!token) return;
    const result = await fetchPendingListings(token);
    if (result.ok) setLoad({ status: "ready", items: result.items });
  }

  /** Karar verilen ilan listeden çıkar; seri incelemede sıradaki ilan açılır */
  function removeItem(vehicleId: string) {
    const next = nextReviewId(items, vehicleId);
    setReview((r) => (r.open && r.id === vehicleId ? { open: true, id: next } : r));
    setLoad((current) =>
      current.status === "ready"
        ? { ...current, items: current.items.filter((item) => item.vehicle.id !== vehicleId) }
        : current,
    );
  }

  /** Onayla / Reddet / Tekrar denetle: kart ve seri inceleme aynı yolu kullanır */
  async function decide(item: PendingListing, action: ListingDecision["action"]): Promise<ReviewOutcome> {
    const { vehicle } = item;
    const title = `${vehicle.title} · ${vehicle.year}`;
    const token = await getAccessToken();
    const result = token
      ? await submitListingDecision({ action, vehicleId: vehicle.id }, token)
      : ({ ok: false, status: 401, message: "" } as const);

    if (!result.ok) {
      if (result.status === 401 || result.status === 403) onUnauthorized();
      return { ok: false, message: result.message || "İşlem tamamlanamadı. Biraz sonra tekrar dene." };
    }

    let message: string;
    let removed = true;
    if (action === "approve") message = `${title}: onaylandı${result.published ? " ve yayına alındı" : ""}.`;
    else if (action === "reject") message = `${title}: reddedildi; video ve fotoğraflar silindi.`;
    // Otomatik denetim yayına almaz: temizse ilan listede kalır, onay bekler
    else if (result.decision === "rejected") message = `${title}: otomatik denetim reddetti; medya silindi.`;
    else {
      removed = false;
      message =
        result.decision === "safe"
          ? `${title}: otomatik tarama temiz; yayın için onayın bekleniyor.`
          : `${title}: otomatik denetim yine karar veremedi.`;
    }

    setNotice(message);
    if (removed) {
      adminListingDecided();
      removeItem(vehicle.id);
    } else {
      void refreshQuietly();
    }
    return { ok: true, message };
  }

  return (
    <section aria-labelledby="pending-listings-heading" className="mt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="pending-listings-heading" className="text-[20px] font-semibold [font-family:var(--font-display)]">
            İçerik denetimi
          </h2>
          <p className="text-[14px] text-[#5B616B]">
            {load.status === "ready"
              ? items.length > 0
                ? `${items.length} ilan karar bekliyor · en eski önce`
                : "Karar bekleyen ilan yok."
              : "Yeni ilanlar yalnızca senin onayınla yayına girer."}
          </p>
        </div>
        <button type="button" onClick={() => reload()} className={SECONDARY_BUTTON}>
          Yenile
        </button>
      </div>

      {load.status === "ready" && items.length > 0 && (
        <button
          type="button"
          onClick={() => setReview({ open: true, id: items[0].vehicle.id })}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#003399] text-[16px] font-semibold text-white transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
        >
          <Play aria-hidden="true" className="h-4 w-4" fill="currentColor" />
          İncelemeye başla ({items.length})
        </button>
      )}

      <div role="status" aria-live="polite">
        {notice && <p className="mt-3 rounded-md bg-[#E6F6EC] px-3 py-2 text-[14px] text-[#1B7A3D]">{notice}</p>}
      </div>

      {load.status === "loading" && <div aria-hidden="true" className="mt-4 h-44 animate-pulse rounded-lg bg-[#DDE1E6]" />}
      {load.status === "error" && (
        <div role="status" className="mt-4 flex flex-col items-center gap-3 text-center">
          <p className="text-[15px] text-[#5B616B]">{load.message}</p>
          <button type="button" onClick={() => reload()} className={SECONDARY_BUTTON}>
            Tekrar dene
          </button>
        </div>
      )}
      {load.status === "ready" && items.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.vehicle.id}>
              <PendingListingCard
                item={item}
                onDecide={decide}
                onReview={() => setReview({ open: true, id: item.vehicle.id })}
              />
            </li>
          ))}
        </ul>
      )}

      {review.open && (
        <ListingReviewer
          items={items}
          currentId={review.id}
          onNavigate={(id) => setReview({ open: true, id })}
          onDecide={decide}
          onClose={() => setReview({ open: false })}
        />
      )}
    </section>
  );
}

export function PendingListingCard({
  item,
  onDecide,
  onReview,
}: {
  item: PendingListing;
  onDecide: (item: PendingListing, action: ListingDecision["action"]) => Promise<ReviewOutcome>;
  /** Videoyu tam ekranda izle ve karar ver (seri inceleme bu ilandan başlar) */
  onReview: () => void;
}) {
  const [pending, setPending] = useState<ListingDecision["action"] | null>(null);
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { vehicle, reasons, needsReview, aiClean, media, description, watchUrl, posterUrl, sellerUsername } = item;
  const title = `${vehicle.title} · ${vehicle.year}`;
  const publishesOnApprove = vehicle.status === "pending_moderation" || vehicle.status === "pending_approval";
  const sensitive = isSensitiveListing(item);

  async function run(action: ListingDecision["action"]) {
    setConfirmingReject(false);
    setError(null);
    setPending(action);
    const outcome = await onDecide(item, action);
    // Karar verildiyse kart listeden kalkar; kalırsa (hata, tekrar denetim) düğmeler açılır
    setPending(null);
    if (!outcome.ok) setError(outcome.message);
  }

  return (
    <article className="rounded-2xl border border-[#E3E6EA] bg-white p-3">
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onReview}
          aria-label={`${title}: videoyu izle ve karar ver`}
          className="relative h-[112px] w-[63px] shrink-0 overflow-hidden rounded-lg bg-[#1C1F24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
        >
          {posterUrl && (
            <Image
              src={posterUrl}
              alt=""
              fill
              unoptimized
              sizes="63px"
              className={`object-cover ${sensitive ? "blur-md" : ""}`}
            />
          )}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white">
              <Play aria-hidden="true" className="ml-0.5 h-4 w-4" fill="currentColor" />
            </span>
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-[17px] font-semibold leading-tight [font-family:var(--font-display)]">{title}</h3>
            <span className="shrink-0 rounded-full bg-[#EEF0F3] px-2 py-0.5 text-[12px] font-semibold text-[#5B616B]">
              {STATUS_LABELS[vehicle.status]}
            </span>
          </div>
          <p className="mt-0.5 text-[15px] font-bold tabular-nums">
            {currencySymbol(vehicle.currency)}
            {formatAmount(vehicle.price)}
            {vehicle.city ? <span className="font-normal text-[#5B616B]"> · {vehicle.city}</span> : null}
          </p>
          <p className="mt-0.5 truncate text-[13px] text-[#5B616B]">
            {[sellerUsername ? `@${sellerUsername}` : null, formatRelativeTime(vehicle.createdAt)].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Denetim nedenleri">
            {aiClean ? (
              <span className="rounded-full bg-[#E6F6EC] px-2 py-0.5 text-[12px] font-semibold text-[#1B7A3D]">
                Otomatik tarama temiz · videoyu izleyip onayla
              </span>
            ) : needsReview ? (
              reasons.map((reason) => (
                <span key={reason} className="rounded-full bg-[#FEF6E7] px-2 py-0.5 text-[12px] font-semibold text-[#8A6116]">
                  {REASON_LABELS[reason]}
                </span>
              ))
            ) : (
              <span className="rounded-full bg-[#EEF0F3] px-2 py-0.5 text-[12px] font-semibold text-[#5B616B]">
                Otomatik denetim sürüyor ya da yarıda kaldı
              </span>
            )}
          </div>
        </div>
      </div>

      {description && (
        // Dolgu dış kutuda: line-clamp taşan satırı dolgu alanında göstermesin
        <div className="mt-2 rounded-md bg-[#F6F7F9] px-3 py-2">
          <p className="line-clamp-2 whitespace-pre-wrap break-words text-[14px] text-[#4A5058]">{description}</p>
        </div>
      )}

      <div role="status" aria-live="polite">
        {error && <p className="mt-2 rounded-md bg-[#FDEDEC] px-3 py-2 text-[13px] text-[#B42318]">{error}</p>}
      </div>

      {confirmingReject ? (
        <div className="mt-3 rounded-md bg-[#FDEDEC] p-3">
          <p className="text-[14px] text-[#15181C]">
            İlan reddedilsin mi? Video ve fotoğraflar kalıcı olarak silinir; satıcı Vitrinim&apos;de &quot;topluluk
            kurallarına uymadığı için yayınlanmadı&quot; uyarısını görür.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setConfirmingReject(false)} className={`${SECONDARY_BUTTON} h-11`}>
              Vazgeç
            </button>
            <button
              type="button"
              onClick={() => void run("reject")}
              className="h-11 rounded-md bg-[#C4282E] text-[14px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C4282E] focus-visible:ring-offset-2"
            >
              Evet, reddet
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={pending !== null}
            aria-busy={pending === "reject"}
            onClick={() => setConfirmingReject(true)}
            className="h-11 rounded-md border border-[#C4282E] bg-white px-3 text-[14px] font-semibold text-[#C4282E] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C4282E] focus-visible:ring-offset-2"
          >
            {pending === "reject" ? "Reddediliyor…" : "Reddet ve sil"}
          </button>
          <button
            type="button"
            disabled={pending !== null}
            aria-busy={pending === "approve"}
            onClick={() => void run("approve")}
            className="h-11 rounded-md bg-[#003399] px-3 text-[14px] font-semibold text-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
          >
            {pending === "approve" ? "Kaydediliyor…" : publishesOnApprove ? "Onayla ve yayınla" : "Onayla"}
          </button>
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4">
        <button
          type="button"
          onClick={onReview}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-sm text-[14px] font-semibold text-[#003399] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
        >
          <Play aria-hidden="true" className="h-3.5 w-3.5" fill="currentColor" />
          Videoyu izle
        </button>
        <button
          type="button"
          disabled={pending !== null}
          aria-busy={pending === "recheck"}
          onClick={() => void run("recheck")}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-sm text-[14px] font-semibold text-[#4A5058] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
        >
          <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
          {pending === "recheck" ? "Denetleniyor…" : "Tekrar denetle"}
        </button>
        {media.length > 0 && (
          <button
            type="button"
            onClick={() => setShowMedia((v) => !v)}
            aria-pressed={showMedia}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-sm text-[14px] font-semibold text-[#4A5058] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            {showMedia ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
            {showMedia ? "Görselleri gizle" : `Görseller (${media.length})`}
          </button>
        )}
        {watchUrl && (
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center rounded-sm text-[13px] font-medium text-[#5B616B] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            Cloudflare&apos;de aç ↗
          </a>
        )}
      </div>

      {showMedia && (
        <ul className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-6" aria-label="Video kareleri ve fotoğraflar">
          {media.map((url, index) => (
            <li key={url} className="relative aspect-[9/16] overflow-hidden rounded-md bg-[#1C1F24]">
              <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Görsel ${index + 1}, yeni sekmede aç`}>
                <Image src={url} alt="" fill unoptimized sizes="96px" className="object-cover" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
