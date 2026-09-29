"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { STATUS_LABELS } from "../../lib/listing-status";
import {
  fetchCommentReports,
  formatRelativeTime,
  submitCommentModerationAction,
  type CommentModerationAction,
  type CommentReportItem,
} from "../../lib/moderation";
import { COMMENT_REPORT_REASONS } from "../../lib/reports";
import { profilePath } from "../../lib/username";
import { vehicleIdPath } from "../../lib/vehicle-slug";
import Avatar from "../ui/Avatar";

// /admin/reports → "Yorum şikayetleri" (Google Play kullanıcı içeriği politikası):
// kullanıcıların akıştaki yorum penceresinden ya da masaüstü panelden şikayet
// ettiği yorumlar, yorum başına gruplu. Karar: yorumu sil (şikayetleri de
// kapanır, karar denetim kaydına yazılır) ya da şikayetleri yoksay.
// Yetkiyi /api/admin/comment-reports denetler.

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: CommentReportItem[] };

const SECONDARY_BUTTON =
  "h-10 shrink-0 rounded-md border border-[#C9CED6] bg-white px-4 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2 disabled:opacity-60";

const dateTimeFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

export default function CommentReportsSection({
  getAccessToken,
  onUnauthorized,
}: {
  getAccessToken: () => Promise<string | null>;
  /** 401/403: panelden çıkarılır */
  onUnauthorized: () => void;
}) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const token = await getAccessToken();
      const result = token ? await fetchCommentReports(token) : ({ ok: false, status: 401, message: "" } as const);
      if (!active) return;
      if (result.ok) setLoad({ status: "ready", items: result.items });
      else if (result.status === 401 || result.status === 403) onUnauthorized();
      else setLoad({ status: "error", message: result.message });
    })();
    return () => {
      active = false;
    };
  }, [reloadKey, getAccessToken, onUnauthorized]);

  function reload() {
    setNotice(null);
    setLoad({ status: "loading" });
    setReloadKey((key) => key + 1);
  }

  function resolved(commentId: string, message: string) {
    setNotice(message);
    setLoad((current) =>
      current.status === "ready" ? { ...current, items: current.items.filter((item) => item.comment.id !== commentId) } : current,
    );
  }

  const reportCount = load.status === "ready" ? load.items.reduce((sum, item) => sum + item.reports.length, 0) : 0;

  return (
    <section aria-labelledby="comment-reports-title" className="mt-8">
      <h2 id="comment-reports-title" className="text-[20px] font-semibold [font-family:var(--font-display)]">
        Yorum şikayetleri
      </h2>

      {load.status === "loading" && (
        <div aria-hidden="true" className="mt-4 flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg bg-[#DDE1E6]" />
          ))}
        </div>
      )}

      {load.status === "error" && (
        <div role="status" className="mt-6 flex flex-col items-center gap-4 text-center">
          <p className="text-[15px] text-[#5B616B]">{load.message}</p>
          <button type="button" onClick={reload} className={SECONDARY_BUTTON}>
            Tekrar dene
          </button>
        </div>
      )}

      {load.status === "ready" && (
        <>
          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="text-[14px] text-[#5B616B]">
              {load.items.length > 0
                ? `${load.items.length} yorum · ${reportCount} açık şikayet · en eski önce`
                : "Açık yorum şikayeti yok."}
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
              <li key={item.comment.id}>
                <CommentReportCard
                  item={item}
                  getAccessToken={getAccessToken}
                  onUnauthorized={onUnauthorized}
                  onResolved={(message) => resolved(item.comment.id, message)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function CommentReportCard({
  item,
  getAccessToken,
  onUnauthorized,
  onResolved,
  now,
}: {
  item: CommentReportItem;
  getAccessToken: () => Promise<string | null>;
  onUnauthorized: () => void;
  onResolved: (message: string) => void;
  /** Testler için */
  now?: number;
}) {
  const [pending, setPending] = useState<CommentModerationAction["action"] | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { comment, vehicle, reports } = item;
  const author = comment.authorUsername ? `@${comment.authorUsername}` : (comment.authorDisplayName ?? "Kullanıcı");
  const vehicleUrl = vehicleIdPath(vehicle.id);

  async function run(input: CommentModerationAction, doneMessage: string) {
    setConfirmingDelete(false);
    setError(null);
    setPending(input.action);
    const token = await getAccessToken();
    const result = token ? await submitCommentModerationAction(input, token) : ({ ok: false, status: 401, message: "" } as const);
    setPending(null);
    if (result.ok) onResolved(doneMessage);
    else if (result.status === 401 || result.status === 403) onUnauthorized();
    // Yorum bu arada silinmiş (yazarı ya da satıcı): kart kalkar
    else if (result.status === 404) onResolved(`${author}: yorum zaten silinmiş.`);
    else setError(result.message);
  }

  const deleteComment = () => run({ action: "delete_comment", commentId: comment.id }, `${author}: yorum silindi.`);
  const dismiss = () =>
    run(
      { action: "dismiss", reportIds: reports.map((report) => report.id) },
      `${author}: ${reports.length > 1 ? "şikayetler" : "şikayet"} yoksayıldı.`,
    );

  return (
    <article aria-label={`${author} yorumu hakkında ${reports.length} şikayet`} className="rounded-lg border border-[#E3E6EA] bg-white p-3 text-[#15181C]">
      <a
        href={vehicleUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
      >
        <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-[#E6E8EB]">
          {vehicle.coverUrl && <Image src={vehicle.coverUrl} alt="" fill sizes="40px" className="object-cover" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-[#15181C]">
            {vehicle.title} · {vehicle.year} <span aria-hidden="true">↗</span>
          </span>
          <span className="text-[12.5px] text-[#5B616B]">İlan: {STATUS_LABELS[vehicle.status]}</span>
        </span>
      </a>

      <div className="mt-3 rounded-md bg-[#F6F7F9] p-3">
        <div className="flex items-center gap-2">
          <Avatar url={comment.authorAvatarUrl} name={comment.authorDisplayName ?? comment.authorUsername} size={28} />
          {comment.authorUsername ? (
            <a
              href={profilePath(comment.authorUsername)}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-[14px] font-semibold text-[#15181C] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
            >
              {author}
            </a>
          ) : (
            <span className="truncate text-[14px] font-semibold text-[#15181C]">{author}</span>
          )}
          <time dateTime={comment.createdAt} className="shrink-0 text-[12px] text-[#8A9099]">
            · {formatRelativeTime(comment.createdAt, now)}
          </time>
        </div>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-snug text-[#15181C]">{comment.content}</p>
      </div>

      <ul className="mt-3 flex flex-col gap-2" aria-label={`${reports.length} şikayet`}>
        {reports.map((report) => (
          <li key={report.id} className="rounded-md border border-[#EEF0F3] px-3 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-[14px] font-semibold">{COMMENT_REPORT_REASONS[report.reason] ?? report.reason}</p>
              <time dateTime={report.createdAt} className="text-[12px] text-[#8A9099]">
                {dateTimeFormatter.format(new Date(report.createdAt))}
              </time>
            </div>
            {report.details && <p className="mt-1 whitespace-pre-wrap break-words text-[14px] text-[#4A5058]">{report.details}</p>}
          </li>
        ))}
      </ul>

      <div role="status" aria-live="polite">
        {error && <p className="mt-2 rounded-md bg-[#FDEDEC] px-3 py-2 text-[13px] text-[#B42318]">{error}</p>}
      </div>

      {confirmingDelete ? (
        <div className="mt-3 rounded-md bg-[#FDEDEC] p-3">
          <p className="text-[14px] text-[#15181C]">
            Yorum kalıcı olarak silinsin mi? Yorumun bütün şikayetleri de kapanır; karar denetim kaydına yazılır.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void deleteComment()}
              className="h-10 flex-1 rounded-md bg-[#C4282E] text-[14px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C4282E] focus-visible:ring-offset-2"
            >
              Evet, sil
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="h-10 flex-1 rounded-md border border-[#C9CED6] bg-white text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
            >
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending !== null}
            aria-busy={pending === "delete_comment"}
            onClick={() => setConfirmingDelete(true)}
            className="h-10 rounded-md border border-[#C4282E] bg-white px-3 text-[14px] font-semibold text-[#C4282E] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C4282E] focus-visible:ring-offset-2"
          >
            {pending === "delete_comment" ? "Siliniyor…" : "Yorumu Sil"}
          </button>
          <button
            type="button"
            disabled={pending !== null}
            aria-busy={pending === "dismiss"}
            onClick={() => void dismiss()}
            className="h-10 rounded-md border border-[#C9CED6] bg-white px-3 text-[14px] font-semibold text-[#15181C] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
          >
            {pending === "dismiss" ? "Kapatılıyor…" : reports.length > 1 ? "Şikayetleri Yoksay" : "Şikayeti Yoksay"}
          </button>
        </div>
      )}
    </article>
  );
}
