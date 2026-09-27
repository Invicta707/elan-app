"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import FeedHeader from "./FeedHeader";
import PendingListingsSection from "./moderation/PendingListingsSection";
import { useSupabaseSession } from "../lib/auth";
import { STATUS_LABELS } from "../lib/listing-status";
import {
  fetchModerationQueue,
  submitModerationAction,
  type ModerationAction,
  type ModerationItem,
} from "../lib/moderation";
import { REPORT_REASONS } from "../lib/reports";
import { currencySymbol, formatAmount } from "../lib/search";
import { supabase } from "../lib/supabase";

// /admin/reports: içerik denetimi kuyruğu (components/moderation/PendingListingsSection.tsx),
// açık ilan bildirimleri ve moderasyon işlemleri.
// Yetkiyi /api/admin/reports denetler. Oturum yoksa ya da API 401/403
// dönerse kullanıcı ana sayfaya gönderilir; o ana kadar sadece iskelet görünür.
export default function ModerationView() {
  const router = useRouter();
  const { session, isLoading } = useSupabaseSession();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!isLoading && !userId) router.replace("/");
  }, [isLoading, userId, router]);

  const goHome = useCallback(() => router.replace("/"), [router]);

  return (
    <>
      <FeedHeader activeTab="my-listings" tone="solid" />
      <div className="mx-auto max-w-3xl px-4 pt-2 pb-[max(2.5rem,calc(var(--bottom-nav-height)+1.5rem),env(safe-area-inset-bottom))]">
        <h1 className="text-[26px] font-semibold [font-family:var(--font-display)]">Moderasyon</h1>
        {/* Kullanıcı değişince kuyruklar sıfırdan yüklenir */}
        {userId ? (
          <div key={userId}>
            <PendingListingsSection getAccessToken={currentAccessToken} onUnauthorized={goHome} />
            <h2 className="mt-8 text-[20px] font-semibold [font-family:var(--font-display)]">Bildirimler</h2>
            <ModerationQueue />
          </div>
        ) : (
          <QueueSkeleton />
        )}
      </div>
    </>
  );
}

async function currentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: ModerationItem[] };

function ModerationQueue() {
  const router = useRouter();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const token = await currentAccessToken();
      const result = token
        ? await fetchModerationQueue(token)
        : ({ ok: false, status: 401, message: "" } as const);
      if (!active) return;
      if (result.ok) setLoad({ status: "ready", items: result.items });
      else if (result.status === 401 || result.status === 403) router.replace("/");
      else setLoad({ status: "error", message: result.message });
    })();
    return () => {
      active = false;
    };
  }, [reloadKey, router]);

  function reload() {
    setNotice(null);
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

  if (load.status === "loading") return <QueueSkeleton />;

  if (load.status === "error") {
    return (
      <div role="status" className="mt-10 flex flex-col items-center gap-4 text-center">
        <p className="text-[15px] text-[#5B616B]">{load.message}</p>
        <button type="button" onClick={reload} className={SECONDARY_BUTTON}>
          Tekrar dene
        </button>
      </div>
    );
  }

  const reportCount = load.items.reduce((sum, item) => sum + item.reports.length, 0);

  return (
    <>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="text-[14px] text-[#5B616B]">
          {load.items.length > 0
            ? `${load.items.length} ilan · ${reportCount} açık bildirim · en eski önce`
            : "Açık bildirim yok."}
        </p>
        <button type="button" onClick={reload} className={SECONDARY_BUTTON}>
          Yenile
        </button>
      </div>

      <div role="status" aria-live="polite">
        {notice && <p className="mt-3 rounded-md bg-[#E6F6EC] px-3 py-2 text-[14px] text-[#1B7A3D]">{notice}</p>}
      </div>

      <ul className="mt-4 flex flex-col gap-3">
        {load.items.map((item) => (
          <li key={item.vehicle.id}>
            <ReportCard item={item} onResolved={(message) => resolved(item.vehicle.id, message)} />
          </li>
        ))}
      </ul>
    </>
  );
}

const SECONDARY_BUTTON =
  "h-10 shrink-0 rounded-md border border-[#C9CED6] bg-white px-4 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2 disabled:opacity-60";

const dateTimeFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

function ReportCard({ item, onResolved }: { item: ModerationItem; onResolved: (message: string) => void }) {
  const router = useRouter();
  const [pending, setPending] = useState<ModerationAction["action"] | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { vehicle, reports } = item;
  const vehicleUrl = `/vehicles/${vehicle.id}`;
  const alreadyRemoved = vehicle.status === "rejected";

  async function run(input: ModerationAction, doneMessage: string) {
    setConfirmingRemove(false);
    setError(null);
    setPending(input.action);

    const token = await currentAccessToken();
    const result = token
      ? await submitModerationAction(input, token)
      : ({ ok: false, status: 401, message: "" } as const);
    setPending(null);

    if (result.ok) onResolved(doneMessage);
    else if (result.status === 401 || result.status === 403) router.replace("/");
    else setError(result.message);
  }

  const removeListing = () =>
    run({ action: "remove_listing", vehicleId: vehicle.id }, `${vehicle.title}: ilan yayından kaldırıldı.`);
  const dismiss = () =>
    run(
      { action: "dismiss", reportIds: reports.map((r) => r.id) },
      `${vehicle.title}: ${reports.length > 1 ? "bildirimler" : "bildirim"} kapatıldı.`,
    );

  return (
    <article className="rounded-lg border border-[#E3E6EA] bg-white p-3">
      <div className="flex gap-3">
        <a
          href={vehicleUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${vehicle.title} ilanını yeni sekmede aç`}
          className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md bg-[#E6E8EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
        >
          {vehicle.coverUrl ? (
            <Image src={vehicle.coverUrl} alt="" fill sizes="80px" className="object-cover" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-[11px] text-[#8A9099]">
              Görsel yok
            </span>
          )}
        </a>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="truncate text-[18px] font-semibold leading-tight [font-family:var(--font-display)]">
              {vehicle.title} · {vehicle.year}
            </h2>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold ${
                vehicle.status === "active" ? "bg-[#E6F6EC] text-[#1B7A3D]" : "bg-[#EEF0F3] text-[#5B616B]"
              }`}
            >
              {STATUS_LABELS[vehicle.status]}
            </span>
          </div>
          <p className="mt-0.5 text-[15px] font-bold tabular-nums">
            {currencySymbol(vehicle.currency)}
            {formatAmount(vehicle.price)}
            {vehicle.city ? <span className="font-normal text-[#5B616B]"> · {vehicle.city}</span> : null}
          </p>
          <a
            href={vehicleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-[14px] font-semibold text-[#003399] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            İlanı ve videoyu yeni sekmede aç ↗
          </a>
        </div>
      </div>

      <ul className="mt-3 flex flex-col gap-2" aria-label={`${reports.length} bildirim`}>
        {reports.map((report) => (
          <li key={report.id} className="rounded-md bg-[#F6F7F9] px-3 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-[14px] font-semibold">{REPORT_REASONS[report.reason] ?? report.reason}</p>
              <time dateTime={report.createdAt} className="text-[12px] text-[#8A9099]">
                {dateTimeFormatter.format(new Date(report.createdAt))}
              </time>
            </div>
            {report.details && (
              <p className="mt-1 whitespace-pre-wrap break-words text-[14px] text-[#4A5058]">{report.details}</p>
            )}
          </li>
        ))}
      </ul>

      <div role="status" aria-live="polite">
        {error && <p className="mt-2 rounded-md bg-[#FDEDEC] px-3 py-2 text-[13px] text-[#B42318]">{error}</p>}
      </div>

      {confirmingRemove ? (
        <div className="mt-3 rounded-md bg-[#FDEDEC] p-3">
          <p className="text-[14px] text-[#15181C]">
            İlan yayından kaldırılsın mı? Satıcı ilanı yeniden yayına alamaz ve bu ilanın açık bildirimleri kapatılır.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={removeListing}
              className="h-10 flex-1 rounded-md bg-[#C4282E] text-[14px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C4282E] focus-visible:ring-offset-2"
            >
              Evet, kaldır
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              className="h-10 flex-1 rounded-md border border-[#C9CED6] bg-white text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
            >
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {!alreadyRemoved && (
            <button
              type="button"
              disabled={pending !== null}
              aria-busy={pending === "remove_listing"}
              onClick={() => setConfirmingRemove(true)}
              className="h-10 rounded-md border border-[#C4282E] bg-white px-3 text-[14px] font-semibold text-[#C4282E] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C4282E] focus-visible:ring-offset-2"
            >
              {pending === "remove_listing" ? "Kaldırılıyor…" : "İlanı Yayından Kaldır"}
            </button>
          )}
          <button
            type="button"
            disabled={pending !== null}
            aria-busy={pending === "dismiss"}
            onClick={dismiss}
            className="h-10 rounded-md border border-[#C9CED6] bg-white px-3 text-[14px] font-semibold text-[#15181C] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
          >
            {pending === "dismiss"
              ? "Kapatılıyor…"
              : reports.length > 1
                ? "Bildirimleri Kapat (Yoksay)"
                : "Bildirimi Kapat (Yoksay)"}
          </button>
        </div>
      )}
    </article>
  );
}

function QueueSkeleton() {
  return (
    <div aria-hidden="true" className="mt-4 flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-44 animate-pulse rounded-lg bg-[#DDE1E6]" />
      ))}
    </div>
  );
}
