"use client";

import { Eye, EyeOff } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { REASON_LABELS } from "../../lib/content-moderation";
import { STATUS_LABELS } from "../../lib/listing-status";
import {
  fetchPendingListings,
  submitListingDecision,
  type ListingDecision,
  type PendingListing,
} from "../../lib/moderation";
import { currencySymbol, formatAmount } from "../../lib/search";

// /admin/reports → "İçerik denetimi": otomatik denetimin karar veremediği ilanlar
// (şüpheli, sağlayıcı yok ya da hata, denetim yarıda kaldı). Bu ilanlar akışta
// görünmez; burada onaylanır (yayına girer), reddedilir (medya silinir) ya da
// otomatik denetim yeniden çalıştırılır. Yetkiyi /api/admin/listings denetler.

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: PendingListing[] };

const SECONDARY_BUTTON =
  "h-10 shrink-0 rounded-md border border-[#C9CED6] bg-white px-4 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2 disabled:opacity-60";

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

  function reload(message: string | null = null) {
    setNotice(message);
    setLoad({ status: "loading" });
    setReloadKey((k) => k + 1);
  }

  function resolved(vehicleId: string, message: string) {
    setNotice(message);
    setLoad((current) =>
      current.status === "ready"
        ? { ...current, items: current.items.filter((item) => item.vehicle.id !== vehicleId) }
        : current,
    );
  }

  return (
    <section aria-labelledby="pending-listings-heading" className="mt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="pending-listings-heading" className="text-[20px] font-semibold [font-family:var(--font-display)]">
            İçerik denetimi
          </h2>
          <p className="text-[14px] text-[#5B616B]">
            {load.status === "ready"
              ? load.items.length > 0
                ? `${load.items.length} ilan karar bekliyor · en eski önce`
                : "Karar bekleyen ilan yok."
              : "Otomatik denetimin karar veremediği ilanlar."}
          </p>
        </div>
        <button type="button" onClick={() => reload()} className={SECONDARY_BUTTON}>
          Yenile
        </button>
      </div>

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
      {load.status === "ready" && load.items.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3">
          {load.items.map((item) => (
            <li key={item.vehicle.id}>
              <PendingListingCard
                item={item}
                getAccessToken={getAccessToken}
                onUnauthorized={onUnauthorized}
                onResolved={(message) => resolved(item.vehicle.id, message)}
                onStillPending={(message) => reload(message)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PendingListingCard({
  item,
  getAccessToken,
  onUnauthorized,
  onResolved,
  onStillPending,
}: {
  item: PendingListing;
  getAccessToken: () => Promise<string | null>;
  onUnauthorized: () => void;
  onResolved: (message: string) => void;
  onStillPending: (message: string) => void;
}) {
  const [pending, setPending] = useState<ListingDecision["action"] | null>(null);
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { vehicle, reasons, needsReview, media, description } = item;
  const title = `${vehicle.title} · ${vehicle.year}`;
  const publishesOnApprove = vehicle.status === "pending_moderation";

  async function run(action: ListingDecision["action"]) {
    setConfirmingReject(false);
    setError(null);
    setPending(action);
    const token = await getAccessToken();
    const result = token
      ? await submitListingDecision({ action, vehicleId: vehicle.id }, token)
      : ({ ok: false, status: 401, message: "" } as const);
    setPending(null);

    if (!result.ok) {
      if (result.status === 401 || result.status === 403) onUnauthorized();
      else setError(result.message);
      return;
    }
    if (action === "approve") onResolved(`${title}: onaylandı${result.published ? " ve yayına alındı" : ""}.`);
    else if (action === "reject") onResolved(`${title}: reddedildi; video ve fotoğraflar silindi.`);
    else if (result.decision === "safe") onResolved(`${title}: otomatik denetimden geçti${result.published ? ", yayında" : ""}.`);
    else if (result.decision === "rejected") onResolved(`${title}: otomatik denetim reddetti; medya silindi.`);
    else onStillPending(`${title}: otomatik denetim yine karar veremedi.`);
  }

  return (
    <article className="rounded-lg border border-[#E3E6EA] bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[18px] font-semibold leading-tight [font-family:var(--font-display)]">{title}</h3>
          <p className="mt-0.5 text-[15px] font-bold tabular-nums">
            {currencySymbol(vehicle.currency)}
            {formatAmount(vehicle.price)}
            {vehicle.city ? <span className="font-normal text-[#5B616B]"> · {vehicle.city}</span> : null}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[#EEF0F3] px-2 py-0.5 text-[12px] font-semibold text-[#5B616B]">
          {STATUS_LABELS[vehicle.status]}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Denetim nedenleri">
        {needsReview ? (
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

      {description && (
        <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-[#F6F7F9] px-3 py-2 text-[14px] text-[#4A5058]">
          {description}
        </p>
      )}

      {media.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowMedia((v) => !v)}
            aria-pressed={showMedia}
            className="inline-flex items-center gap-1.5 rounded-sm text-[14px] font-semibold text-[#003399] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            {showMedia ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
            {showMedia ? "Görselleri gizle" : `Görselleri göster (${media.length})`}
          </button>
          {/* Rahatsız edici olabilir: varsayılan olarak bulanık */}
          <ul className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-6" aria-label="Video kareleri ve fotoğraflar">
            {media.map((url, index) => (
              <li key={url} className="relative aspect-[9/16] overflow-hidden rounded-md bg-[#1C1F24]">
                <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Görsel ${index + 1}, yeni sekmede aç`}>
                  <Image
                    src={url}
                    alt=""
                    fill
                    unoptimized
                    sizes="96px"
                    className={`object-cover transition-[filter] ${showMedia ? "" : "blur-xl"}`}
                  />
                </a>
              </li>
            ))}
          </ul>
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
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void run("reject")}
              className="h-10 flex-1 rounded-md bg-[#C4282E] text-[14px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C4282E] focus-visible:ring-offset-2"
            >
              Evet, reddet
            </button>
            <button type="button" onClick={() => setConfirmingReject(false)} className={`${SECONDARY_BUTTON} flex-1`}>
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending !== null}
            aria-busy={pending === "approve"}
            onClick={() => void run("approve")}
            className="h-10 rounded-md bg-[#003399] px-3 text-[14px] font-semibold text-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
          >
            {pending === "approve" ? "Kaydediliyor…" : publishesOnApprove ? "Onayla ve yayınla" : "Onayla"}
          </button>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => setConfirmingReject(true)}
            className="h-10 rounded-md border border-[#C4282E] bg-white px-3 text-[14px] font-semibold text-[#C4282E] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C4282E] focus-visible:ring-offset-2"
          >
            {pending === "reject" ? "Reddediliyor…" : "Reddet ve sil"}
          </button>
          <button
            type="button"
            disabled={pending !== null}
            aria-busy={pending === "recheck"}
            onClick={() => void run("recheck")}
            className={SECONDARY_BUTTON}
          >
            {pending === "recheck" ? "Denetleniyor…" : "Tekrar denetle"}
          </button>
        </div>
      )}
    </article>
  );
}
