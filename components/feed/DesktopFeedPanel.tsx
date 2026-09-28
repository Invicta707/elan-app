"use client";

import { ChevronRight, ExternalLink, Heart, LoaderCircle, MessageCircle, Phone, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { fetchVehicleDetails, type FeedVehicle, type VehicleDetails } from "../../lib/feed";
import { partnerName } from "../../lib/messages";
import { formatTurkishPhone, phoneCallHref } from "../../lib/phone";
import { formatAmount } from "../../lib/search";
import { getCommentCount, setCommentCount } from "../../lib/use-comment-counts";
import { useSellerProfile } from "../../lib/use-follow";
import { profilePath } from "../../lib/username";
import { BODY_TYPE_LABELS, FUEL_LABELS, TRANSMISSION_LABELS } from "../../lib/vehicle-labels";
import AuthGatedLink from "../AuthGatedLink";
import HeaderProfileButton from "../HeaderProfileButton";
import { CommentComposerArea, CommentList, CommentListError, CommentThreadDialogs } from "../comments/CommentThreadView";
import { useCommentThread } from "../comments/useCommentThread";
import FollowButton from "../social/FollowButton";
import Avatar from "../ui/Avatar";
import ConditionList from "../vehicle/ConditionList";
import MessageSellerButton from "../vehicle/MessageSellerButton";
import PhotoGallery from "../vehicle/PhotoGallery";
import PricePlate from "../vehicle/PricePlate";
import { useSellerContact } from "../vehicle/useSellerContact";
import { useSellerPhone } from "../vehicle/useSellerPhone";

// Masaüstü düzeni (1024 px ve üstü, TikTok Web modeli): video sütununun
// sağındaki kalıcı, koyu panel. Ekrandaki (aktif) ilanın fiyatı, özellikleri,
// satıcı kartı, WhatsApp / Ara / Mesaj düğmeleri ve yorumları; yorum yazma
// alanı panelin altında sabit. Üstte, akış başlığının sağındaki düğmeler
// (ara, favoriler, İlan Ver, profil). Panelde ↑/↓ panelin kendisini kaydırır
// (data-feed-keys="off"); akışta ise bir sonraki ilana geçer.

type DetailsLoad = { status: "loading" } | { status: "error" } | { status: "ready"; details: VehicleDetails };

const panelScroll = "[scrollbar-color:#3F3F46_transparent] [scrollbar-width:thin]";

export default function DesktopFeedPanel({
  vehicle,
  focusRequest,
}: {
  /** undefined: akış yükleniyor; null: gösterilecek ilan yok (akış boş ya da sonu) */
  vehicle: FeedVehicle | null | undefined;
  /** Akıştaki "Yorum" düğmesine her basışta artar: yorumlara kaydırılır, yazma alanına odaklanılır */
  focusRequest: number;
}) {
  if (vehicle) return <VehiclePanel key={vehicle.id} vehicle={vehicle} focusRequest={focusRequest} />;
  return vehicle === undefined ? <PanelSkeleton /> : <PanelEmpty />;
}

/**
 * Akış başlığının masaüstündeki sağ düğmeleri (FeedHeader actionsInPanel):
 * panelin üst çubuğu. Veri istemez; sunucuda da çizilir (başlık boş kalmaz).
 */
export function PanelToolbar() {
  return (
    <div className="flex h-16 shrink-0 items-center gap-2 border-b border-[#27272A] px-4">
      <Link
        href="/search"
        className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-[#18181B] px-3.5 text-[14.5px] text-[#A1A1AA] ring-1 ring-inset ring-[#27272A] transition-colors hover:bg-[#27272A] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="truncate">Marka, model ara</span>
      </Link>
      <Link
        href="/favorites"
        aria-label="Favorilerim"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <Heart aria-hidden="true" className="h-5 w-5" />
      </Link>
      <AuthGatedLink
        href="/sell"
        aria-label="İlan Ver"
        className="flex h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-white/40 px-3 text-[14.5px] font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white xl:px-3.5"
      >
        <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
        <span className="hidden xl:inline">İlan Ver</span>
      </AuthGatedLink>
      <HeaderProfileButton overlay />
    </div>
  );
}

function VehiclePanel({ vehicle, focusRequest }: { vehicle: FeedVehicle; focusRequest: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const commentsRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const guestButtonRef = useRef<HTMLButtonElement>(null);
  const [load, setLoad] = useState<DetailsLoad>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  const vehicleId = vehicle.id;
  const onTotalChange = useCallback((total: number) => setCommentCount(vehicleId, total), [vehicleId]);
  const [initialTotal] = useState(() => getCommentCount(vehicleId) ?? vehicle.commentsCount);
  const thread = useCommentThread({ vehicleId, initialTotal, onTotalChange });

  // Kasa tipi, açıklama ve fotoğraflar (akış sorgusunda yok)
  useEffect(() => {
    let active = true;
    fetchVehicleDetails(vehicleId)
      .then((details) => {
        if (active) setLoad({ status: "ready", details });
      })
      .catch((error) => {
        console.error("İlan detayları yüklenemedi:", error);
        if (active) setLoad({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [vehicleId, reloadKey]);

  // Akıştaki "Yorum" düğmesi: yorumlara kaydır, yazma alanına (misafirde giriş düğmesine) odaklan
  const handledFocus = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === handledFocus.current) return;
    handledFocus.current = focusRequest;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    commentsRef.current?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    (composerRef.current ?? guestButtonRef.current)?.focus({ preventScroll: true });
  }, [focusRequest]);

  const details = load.status === "ready" ? load.details : null;
  const title = `${vehicle.brandName} ${vehicle.modelName}`;
  const meta = [String(vehicle.year), `${formatAmount(vehicle.mileageKm)} km`, vehicle.city].filter(Boolean).join(" · ");

  return (
    <>
      <div ref={scrollRef} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${panelScroll}`}>
        <div className="px-4 pt-4">
          <PanelSeller sellerId={vehicle.sellerId} />
        </div>

        <section aria-labelledby="panel-title" className="px-4 pt-4">
          <div className="flex items-start justify-between gap-3">
            <h2 id="panel-title" className="min-w-0 text-[26px] font-semibold leading-tight [font-family:var(--font-display)]">
              {title}
            </h2>
            <Link
              href={`/vehicles/${vehicle.id}`}
              aria-label="İlan sayfasını aç"
              title="İlan sayfasını aç"
              className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#A1A1AA] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ExternalLink aria-hidden="true" className="h-[18px] w-[18px]" />
            </Link>
          </div>
          <p className="mt-0.5 text-[14px] text-[#A1A1AA]">{meta}</p>
          <PricePlate price={vehicle.price} currency={vehicle.currency} className="mt-3" />
          {vehicle.hasHeavyDamage && (
            <p className="mt-3 inline-flex rounded-md bg-[#E5484D] px-2 py-0.5 text-[13px] font-semibold text-white">
              Ağır hasar kayıtlı
            </p>
          )}
        </section>

        <PanelContact vehicle={vehicle} />

        <PanelSection title="Araç bilgileri">
          <dl className="grid grid-cols-2 gap-2">
            <SpecTile label="Yıl" value={vehicle.year} />
            <SpecTile label="Kilometre" value={`${formatAmount(vehicle.mileageKm)} km`} />
            <SpecTile label="Yakıt" value={FUEL_LABELS[vehicle.fuelType] ?? vehicle.fuelType} />
            <SpecTile label="Vites" value={TRANSMISSION_LABELS[vehicle.transmission] ?? vehicle.transmission} />
            <SpecTile
              label="Kasa tipi"
              value={load.status === "loading" ? "…" : details?.bodyType ? (BODY_TYPE_LABELS[details.bodyType] ?? "—") : "—"}
            />
            <SpecTile label="Şehir" value={vehicle.city ?? "—"} />
          </dl>
          <div className="mt-3 rounded-xl bg-[#18181B] px-3 py-2.5">
            <p className="text-[12px] font-medium text-[#A1A1AA]">Ekspertiz</p>
            <ConditionList vehicle={vehicle} className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[13.5px] font-medium text-white" />
            <p className="mt-1.5 text-[13.5px] font-medium">
              {vehicle.hasHeavyDamage ? <span className="text-[#FCA5A5]">Ağır hasar kayıtlı</span> : "Ağır hasar kaydı yok"}
            </p>
          </div>
        </PanelSection>

        {load.status === "error" && (
          <div role="status" className="mx-4 mt-5 flex items-center justify-between gap-3 rounded-xl bg-[#3F1D1D] px-3 py-2.5 text-[13.5px] text-[#FCA5A5]">
            <span>Açıklama ve fotoğraflar yüklenemedi.</span>
            <button
              type="button"
              onClick={() => {
                setLoad({ status: "loading" });
                setReloadKey((key) => key + 1);
              }}
              className="shrink-0 rounded-md px-2 py-1 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Tekrar dene
            </button>
          </div>
        )}

        {details?.description && (
          <PanelSection title="Satıcının açıklaması">
            <Description text={details.description} />
          </PanelSection>
        )}

        {load.status === "loading" && (
          <div aria-hidden="true" className="mt-5 flex gap-2 overflow-hidden px-4">
            <div className="aspect-[4/3] w-[78%] shrink-0 rounded-lg bg-[#27272A] motion-safe:animate-pulse" />
            <div className="aspect-[4/3] w-[78%] shrink-0 rounded-lg bg-[#27272A] motion-safe:animate-pulse" />
          </div>
        )}
        {details && details.photoUrls.length > 0 && (
          <div className="mt-5 px-4">
            <PhotoGallery photos={details.photoUrls} title={title} lightboxContainer={document.body} tone="dark" />
          </div>
        )}

        <section ref={commentsRef} aria-labelledby="panel-comments-title" className="mt-6 scroll-mt-2 border-t border-[#27272A] pt-4">
          <h3 id="panel-comments-title" className="px-4 text-[15px] font-semibold">
            Yorumlar{thread.total > 0 ? <span className="font-normal text-[#A1A1AA]"> · {thread.total.toLocaleString("tr-TR")}</span> : null}
          </h3>
          <CommentList thread={thread} tone="dark" scrollRoot={scrollRef} className="px-4 pb-2" />
          <CommentListError thread={thread} tone="dark" />
        </section>
      </div>

      <CommentComposerArea thread={thread} tone="dark" textareaRef={composerRef} guestButtonRef={guestButtonRef} />
      <CommentThreadDialogs thread={thread} />
    </>
  );
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 px-4">
      <h3 className="mb-2 text-[15px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function SpecTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl bg-[#18181B] px-3 py-2.5">
      <dt className="text-[12px] font-medium text-[#A1A1AA]">{label}</dt>
      <dd className="mt-0.5 truncate text-[15px] font-semibold text-white">{value}</dd>
    </div>
  );
}

/** Uzun açıklama 5 satırda kısalır; "Devamını göster" açar */
function Description({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 280 || text.split("\n").length > 5;
  return (
    <div>
      <p className={`whitespace-pre-line break-words text-[15px] leading-relaxed text-[#E4E4E7] ${expanded || !long ? "" : "line-clamp-5"}`}>
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-1 rounded-sm text-[14px] font-semibold text-white underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {expanded ? "Daha az göster" : "Devamını göster"}
        </button>
      )}
    </div>
  );
}

/** Satıcı kartı: avatar, ad ve @kullanıcı_adı (vitrine gider), takip */
function PanelSeller({ sellerId }: { sellerId: string | null }) {
  const seller = useSellerProfile(sellerId);
  if (!seller) {
    return (
      <div aria-hidden="true" className="flex items-center gap-3 motion-safe:animate-pulse">
        <span className="h-11 w-11 rounded-full bg-[#27272A]" />
        <span className="h-3.5 w-32 rounded bg-[#27272A]" />
      </div>
    );
  }

  const name = partnerName(seller, "buyer");
  const identity = (
    <>
      <Avatar url={seller.avatarUrl} name={seller.displayName ?? seller.username} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15.5px] font-semibold text-white">{name}</span>
        {seller.username && (
          <span className="flex items-center gap-0.5 text-[13px] text-[#A1A1AA]">
            <span className="truncate">{seller.displayName ? `@${seller.username} · ` : ""}Vitrini gör</span>
            <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
          </span>
        )}
      </span>
    </>
  );

  return (
    <section aria-label="Satıcı" className="flex flex-wrap items-center gap-3">
      {seller.username ? (
        <Link
          href={profilePath(seller.username)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {identity}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{identity}</div>
      )}
      <FollowButton userId={seller.id} variant="panel" name={name} />
    </section>
  );
}

/** WhatsApp, Ara (numara gösterilir, arama bağlantısı) ve gözüyle'den mesaj */
function PanelContact({ vehicle }: { vehicle: FeedVehicle }) {
  const { contact, isContacting, notice } = useSellerContact(vehicle);
  const phone = useSellerPhone(vehicle.id);
  const [messageNotice, setMessageNotice] = useState<string | null>(null);

  const phoneNotice =
    phone.state.status === "missing"
      ? "Bu ilan için telefon numarası bulunamadı."
      : phone.state.status === "error"
        ? "Satıcının numarası alınamadı. Bağlantını kontrol edip tekrar dene."
        : null;
  const shownNotice = messageNotice ?? notice ?? phoneNotice;
  const readyPhone = phone.state.status === "ready" ? phone.state.phone : null;
  const callHref = readyPhone ? phoneCallHref(readyPhone) : null;
  const display = readyPhone ? formatTurkishPhone(readyPhone) : null;

  const secondary =
    "flex h-12 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#27272A] px-2.5 font-semibold text-white transition-colors hover:bg-[#3F3F46] disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

  return (
    <section aria-label="Satıcıyla iletişim" className="mt-4 px-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void contact()}
          disabled={isContacting}
          aria-busy={isContacting}
          className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#25D366] px-3 text-[15px] font-semibold text-[#062612] transition-transform disabled:opacity-70 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#121212]"
        >
          <WhatsAppIcon className="h-5 w-5 shrink-0" />
          {isContacting ? "Açılıyor…" : "WhatsApp"}
        </button>
        {callHref && display ? (
          <a href={callHref} aria-label={`${display} numarasını ara`} className={`${secondary} text-[14.5px] tabular-nums`}>
            <Phone aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
            {display}
          </a>
        ) : (
          <button
            type="button"
            onClick={() => void phone.reveal()}
            disabled={phone.state.status === "loading" || phone.state.status === "missing"}
            aria-busy={phone.state.status === "loading"}
            aria-label="Satıcıyı ara: numarayı göster"
            className={`${secondary} text-[15px]`}
          >
            {phone.state.status === "loading" ? (
              <LoaderCircle aria-hidden="true" className="h-[18px] w-[18px] shrink-0 animate-spin" />
            ) : (
              <Phone aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
            )}
            Ara
          </button>
        )}
      </div>
      <MessageSellerButton
        vehicleId={vehicle.id}
        sellerId={vehicle.sellerId}
        onNotice={setMessageNotice}
        appearance="panel"
        className="mt-2 w-full"
      />
      <div role="status" aria-live="polite">
        {shownNotice && <p className="mt-2 text-[13px] text-[#FCA5A5]">{shownNotice}</p>}
      </div>
    </section>
  );
}

function PanelSkeleton() {
  return (
    <div aria-hidden="true" className="flex-1 space-y-4 overflow-hidden px-4 pt-4 motion-safe:animate-pulse">
      <div className="flex items-center gap-3">
        <span className="h-11 w-11 rounded-full bg-[#27272A]" />
        <span className="h-3.5 w-32 rounded bg-[#27272A]" />
      </div>
      <div className="h-7 w-3/4 rounded bg-[#27272A]" />
      <div className="h-11 w-44 rounded bg-[#27272A]" />
      <div className="flex gap-2">
        <div className="h-12 flex-1 rounded-full bg-[#27272A]" />
        <div className="h-12 flex-1 rounded-full bg-[#27272A]" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded-xl bg-[#27272A]" />
        ))}
      </div>
    </div>
  );
}

function PanelEmpty() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#27272A] text-[#A1A1AA]">
        <MessageCircle aria-hidden="true" className="h-6 w-6" />
      </span>
      <p className="text-[15.5px] font-semibold">İlan ayrıntıları burada</p>
      <p className="max-w-[18rem] text-[14px] text-[#A1A1AA]">
        Akışta bir ilan izlediğinde fiyatı, özellikleri, satıcısı ve yorumları bu panelde görünür.
      </p>
    </div>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
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
      <path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.55L3.5 20.5l1.45-4.35A8.5 8.5 0 1 1 20.5 11.5Z" />
    </svg>
  );
}
