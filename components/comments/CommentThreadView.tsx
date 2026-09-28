"use client";

import { ArrowUp, Flag, LoaderCircle, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { COMMENT_MAX_LENGTH, cleanComment, commentAuthorName, formatCommentTime, type DisplayComment } from "../../lib/comments";
import { suggestedDisplayName } from "../../lib/profile";
import { profilePath, suggestUsername } from "../../lib/username";
import { AuthModalPortal } from "../AuthGatedLink";
import UsernameSheet from "../profile/UsernameSheet";
import Avatar from "../ui/Avatar";
import CommentReportSheet from "./CommentReportSheet";
import type { CommentThread } from "./useCommentThread";

// Yorum listesinin, satırın ve yazma alanının görünümleri. İki tonu var:
// "light": mobildeki beyaz yorum penceresi (CommentsSheet);
// "dark": masaüstündeki koyu yan panel (DesktopFeedPanel).
// Davranış useCommentThread'de; burada yalnızca çizim.

export type CommentTone = "light" | "dark";

const TONES = {
  light: {
    name: "text-[#4A5058]",
    content: "text-[#15181C]",
    meta: "text-[#8A9099]",
    seller: "bg-[#EAEFF7] text-[#003399]",
    rowAction: "text-[#8A9099] hover:bg-black/5",
    danger: "hover:text-[#B42318]",
    reported: "text-[#B42318]",
    failed: "text-[#B42318]",
    confirmText: "text-[#4A5058]",
    cancel: "bg-[#F2F3F5] text-[#15181C]",
    skeleton: "bg-[#EEF0F3]",
    emptyIcon: "bg-[#F2F3F5] text-[#5B616B]",
    emptyTitle: "text-[#15181C]",
    muted: "text-[#5B616B]",
    softButton: "bg-[#F2F3F5] text-[#15181C]",
    ghostButton: "text-[#5B616B] hover:bg-black/5",
    errorBox: "bg-[#FDEDEC] text-[#B42318]",
    ring: "focus-visible:ring-[#003399]",
    composer: "border-[#EEF0F3] bg-white",
    field: "border-[#D5D9DF] bg-white focus-within:border-[#003399] focus-within:ring-[#003399]/10",
    input: "text-[#15181C] placeholder:text-[#9AA0A8]",
    sendIdle: "bg-[#9AA8C8] opacity-70",
    sendRing: "focus-visible:ring-[#003399] focus-visible:ring-offset-white",
    counter: "text-[#8A9099]",
    error: "text-[#B42318]",
    guest: "border-[#EEF0F3]",
  },
  dark: {
    name: "text-[#D4D4D8]",
    content: "text-[#F4F4F5]",
    meta: "text-[#A1A1AA]",
    seller: "bg-white/10 text-white",
    rowAction: "text-[#A1A1AA] hover:bg-white/10",
    danger: "hover:text-[#FCA5A5]",
    reported: "text-[#FCA5A5]",
    failed: "text-[#FCA5A5]",
    confirmText: "text-[#D4D4D8]",
    cancel: "bg-[#27272A] text-white",
    skeleton: "bg-[#27272A]",
    emptyIcon: "bg-[#27272A] text-[#A1A1AA]",
    emptyTitle: "text-white",
    muted: "text-[#A1A1AA]",
    softButton: "bg-[#27272A] text-white",
    ghostButton: "text-[#A1A1AA] hover:bg-white/10",
    errorBox: "bg-[#3F1D1D] text-[#FCA5A5]",
    ring: "focus-visible:ring-white",
    composer: "border-[#27272A] bg-[#121212]",
    field: "border-[#3F3F46] bg-[#18181B] focus-within:border-white/50 focus-within:ring-white/10",
    input: "text-white placeholder:text-[#71717A]",
    sendIdle: "bg-[#3F3F46] opacity-80",
    sendRing: "focus-visible:ring-white focus-visible:ring-offset-[#121212]",
    counter: "text-[#A1A1AA]",
    error: "text-[#FCA5A5]",
    guest: "border-[#27272A]",
  },
} as const;

/**
 * Liste: iskelet, hata, boş durum, satırlar ve "Daha fazla yorum". Sona gelince
 * sonraki sayfa kendiliğinden istenir (scrollRoot: kaydırılan kutu; yoksa ekran).
 */
export function CommentList({
  thread,
  tone,
  listRef,
  scrollRoot,
  className = "",
}: {
  thread: CommentThread;
  tone: CommentTone;
  listRef?: RefObject<HTMLUListElement | null>;
  scrollRoot?: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const t = TONES[tone];
  const sentinelRef = useRef<HTMLLIElement>(null);
  const { load, comments, cursor, loadingMore, loadMore } = thread;

  // Listenin sonuna gelince sonraki sayfa
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !cursor || typeof IntersectionObserver === "undefined") return;
    const root = scrollRoot?.current ?? listRef?.current ?? null;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { root, rootMargin: "120px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cursor, loadMore, listRef, scrollRoot]);

  return (
    <ul ref={listRef} aria-label="Yorumlar" className={className}>
      {load.status === "loading" && <CommentSkeleton tone={tone} />}
      {load.status === "error" && (
        <li role="status" className="flex flex-col items-center gap-3 py-10 text-center">
          <p className={`text-[14.5px] ${t.muted}`}>{load.message}</p>
          <button
            type="button"
            onClick={thread.reload}
            className={`h-10 rounded-full px-5 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 ${t.softButton} ${t.ring}`}
          >
            Tekrar dene
          </button>
        </li>
      )}
      {load.status === "ready" && comments.length === 0 && (
        <li className="flex flex-col items-center gap-2 py-12 text-center">
          <span className={`flex h-12 w-12 items-center justify-center rounded-full ${t.emptyIcon}`}>
            <MessageCircle aria-hidden="true" className="h-6 w-6" />
          </span>
          <p className={`text-[15.5px] font-semibold ${t.emptyTitle}`}>Henüz yorum yok</p>
          <p className={`max-w-[16rem] text-[14px] ${t.muted}`}>İlk yorumu sen yap!</p>
        </li>
      )}
      {comments.map((comment) => (
        <CommentRow
          key={comment.id}
          tone={tone}
          comment={comment}
          confirming={thread.confirmingDelete === comment.id}
          reported={thread.reported.has(comment.id)}
          onAskDelete={() => thread.setConfirmingDelete(comment.id)}
          onCancelDelete={() => thread.setConfirmingDelete(null)}
          onDelete={() => void thread.remove(comment)}
          onRetry={() => thread.retry(comment)}
          onReport={() => thread.setReporting(comment)}
        />
      ))}
      {load.status === "ready" && cursor && (
        <li ref={sentinelRef} className="flex justify-center py-3">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className={`inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13.5px] font-semibold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 ${t.ghostButton} ${t.ring}`}
          >
            {loadingMore && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
            {loadingMore ? "Yükleniyor…" : "Daha fazla yorum"}
          </button>
        </li>
      )}
    </ul>
  );
}

/** Silme ya da sayfa hatası (listenin altında) */
export function CommentListError({ thread, tone }: { thread: CommentThread; tone: CommentTone }) {
  return (
    <div role="status" aria-live="polite">
      {thread.listError && (
        <p className={`mx-4 mb-1 rounded-lg px-3 py-2 text-[13px] ${TONES[tone].errorBox}`}>{thread.listError}</p>
      )}
    </div>
  );
}

export function CommentRow({
  comment,
  tone = "light",
  confirming,
  reported = false,
  onAskDelete,
  onCancelDelete,
  onDelete,
  onRetry,
  onReport,
}: {
  comment: DisplayComment;
  tone?: CommentTone;
  confirming: boolean;
  /** Bu oturumda şikayet edildi */
  reported?: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onReport?: () => void;
}) {
  const t = TONES[tone];
  const name = commentAuthorName(comment);
  const profileHref = comment.username ? profilePath(comment.username) : null;
  const avatar = <Avatar url={comment.avatarUrl} name={comment.displayName ?? comment.username} size={36} />;
  // Başkasının, sunucuya ulaşmış yorumu şikayet edilebilir (misafir de edebilir)
  const canReport = Boolean(onReport) && !comment.isMine && !comment.pending;

  return (
    <li className={`flex gap-3 py-3 ${comment.pending === "sending" ? "opacity-60" : ""}`}>
      {profileHref ? (
        <Link href={profileHref} aria-label={`${name} vitrini`} className={`shrink-0 self-start rounded-full focus-visible:outline-none focus-visible:ring-2 ${t.ring}`}>
          {avatar}
        </Link>
      ) : (
        <span className="shrink-0 self-start">{avatar}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] leading-5">
          {profileHref ? (
            <Link href={profileHref} className={`truncate font-semibold hover:underline focus-visible:outline-none focus-visible:underline ${t.name}`}>
              {name}
            </Link>
          ) : (
            <span className={`truncate font-semibold ${t.name}`}>{name}</span>
          )}
          {comment.isSeller && <span className={`rounded px-1.5 py-px text-[11px] font-semibold ${t.seller}`}>Satıcı</span>}
          <time dateTime={comment.createdAt} className={t.meta}>
            · {comment.pending === "sending" ? "gönderiliyor…" : formatCommentTime(comment.createdAt)}
          </time>
        </p>
        <p className={`mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-snug ${t.content}`}>{comment.content}</p>

        {comment.pending === "failed" && (
          <p className={`mt-1 text-[12.5px] ${t.failed}`}>
            Gönderilemedi.{" "}
            <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">
              Tekrar dene
            </button>{" "}
            ·{" "}
            <button type="button" onClick={onDelete} className="font-semibold underline underline-offset-2">
              Kaldır
            </button>
          </p>
        )}

        {confirming && (
          <div className="mt-1.5 flex items-center gap-2 text-[13px]">
            <span className={t.confirmText}>Yorum silinsin mi?</span>
            <button
              type="button"
              onClick={onDelete}
              className="h-8 rounded-full bg-[#C4282E] px-3 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C4282E] focus-visible:ring-offset-1"
            >
              Sil
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              className={`h-8 rounded-full px-3 font-semibold focus-visible:outline-none focus-visible:ring-2 ${t.cancel} ${t.ring}`}
            >
              Vazgeç
            </button>
          </div>
        )}
      </div>
      {!confirming && (canReport || (comment.canDelete && !comment.pending)) && (
        <div className="flex shrink-0 items-start gap-0.5 self-start">
          {canReport &&
            (reported ? (
              <span
                role="img"
                aria-label={`${name} yorumu şikayet edildi`}
                title="Şikayet edildi"
                className={`flex h-8 w-8 items-center justify-center ${t.reported}`}
              >
                <Flag aria-hidden="true" className="h-4 w-4" fill="currentColor" />
              </span>
            ) : (
              <button
                type="button"
                onClick={onReport}
                aria-haspopup="dialog"
                aria-label={`${name} yorumunu şikayet et`}
                title="Şikayet et"
                className={`flex h-8 w-8 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 ${t.rowAction} ${t.danger} ${t.ring}`}
              >
                <Flag aria-hidden="true" className="h-4 w-4" />
              </button>
            ))}
          {comment.canDelete && !comment.pending && (
            <button
              type="button"
              onClick={onAskDelete}
              aria-label={`${name} yorumunu sil`}
              className={`h-8 rounded-full px-2 text-[12.5px] font-semibold focus-visible:outline-none focus-visible:ring-2 ${t.rowAction} ${t.danger} ${t.ring}`}
            >
              Sil
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** Otomatik büyüyen yazma alanı; masaüstünde Enter gönderir (Shift+Enter yeni satır) */
export function CommentComposer({
  text,
  onTextChange,
  onSend,
  error,
  avatarUrl,
  name,
  tone = "light",
  keyboardOpen = false,
  textareaRef,
}: {
  text: string;
  onTextChange: (value: string) => void;
  onSend: (value: string) => void;
  error: string | null;
  avatarUrl: string | null;
  name: string | null;
  tone?: CommentTone;
  keyboardOpen?: boolean;
  /** Masaüstü panelde "Yorum" düğmesi yazma alanına odaklanır */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const t = TONES[tone];
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const areaRef = textareaRef ?? ownRef;
  const clean = cleanComment(text);
  const canSend = clean.length > 0 && clean.length <= COMMENT_MAX_LENGTH;
  const inputId = tone === "dark" ? "comment-composer-panel" : "comment-composer";

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 120)}px`;
  }, [text, areaRef]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    onSend(text);
    areaRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      if (window.matchMedia("(pointer: fine)").matches) submit(event);
    }
  }

  return (
    <form
      onSubmit={submit}
      className={`shrink-0 border-t px-3 pt-2 ${t.composer} ${keyboardOpen ? "pb-2" : "pb-[max(0.5rem,env(safe-area-inset-bottom))]"}`}
    >
      {error && (
        <p role="alert" className={`mb-1.5 px-1 text-[13px] font-medium ${t.error}`}>
          {error}
        </p>
      )}
      <div className="flex items-end gap-2">
        <Avatar url={avatarUrl} name={name} size={32} className="mb-1.5 shrink-0" />
        <div className={`flex flex-1 items-end gap-1 rounded-[22px] border py-0.5 pr-0.5 pl-3.5 transition-[border-color,box-shadow] focus-within:ring-4 ${t.field}`}>
          <label htmlFor={inputId} className="sr-only">
            Yorum yaz
          </label>
          <textarea
            id={inputId}
            ref={areaRef}
            rows={1}
            value={text}
            maxLength={COMMENT_MAX_LENGTH}
            placeholder="Yorum ekle…"
            enterKeyHint="send"
            onChange={(event) => onTextChange(event.target.value)}
            onKeyDown={handleKeyDown}
            className={`min-h-[38px] flex-1 resize-none bg-transparent py-2 text-[16px] leading-[1.35] outline-none ${t.input}`}
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Gönder"
            className={`mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-[transform,background-color,opacity] duration-150 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${t.sendRing} ${
              canSend ? "bg-[#003399]" : t.sendIdle
            }`}
          >
            <ArrowUp aria-hidden="true" className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </div>
      </div>
      {text.length > COMMENT_MAX_LENGTH - 100 && (
        <p className={`mt-1 pr-1 text-right text-[12px] tabular-nums ${t.counter}`}>
          {text.length}/{COMMENT_MAX_LENGTH}
        </p>
      )}
    </form>
  );
}

/**
 * Yazma alanı ya da misafirde giriş düğmesi. onSent: yorum iyimser olarak
 * listeye eklendi (pencere listeyi başa kaydırır).
 */
export function CommentComposerArea({
  thread,
  tone,
  keyboardOpen = false,
  textareaRef,
  guestButtonRef,
  onSent,
}: {
  thread: CommentThread;
  tone: CommentTone;
  keyboardOpen?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  guestButtonRef?: RefObject<HTMLButtonElement | null>;
  onSent?: () => void;
}) {
  const { session, profile } = thread;
  if (session) {
    return (
      <CommentComposer
        tone={tone}
        text={thread.text}
        onTextChange={(value) => {
          thread.setText(value);
          if (thread.composerError) thread.setComposerError(null);
        }}
        onSend={(value) => {
          void thread.send(value).then((added) => {
            if (added) onSent?.();
          });
        }}
        error={thread.composerError}
        avatarUrl={profile?.avatarUrl ?? null}
        name={profile?.displayName ?? profile?.username ?? session.user.email ?? null}
        keyboardOpen={keyboardOpen}
        textareaRef={textareaRef}
      />
    );
  }
  return (
    <div className={`shrink-0 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${TONES[tone].guest}`}>
      <button
        ref={guestButtonRef}
        type="button"
        onClick={() => thread.setShowAuth(true)}
        disabled={thread.sessionLoading}
        className="h-12 w-full rounded-full bg-[#003399] text-[15.5px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/30"
      >
        Yorum yapmak için giriş yap
      </button>
    </div>
  );
}

/** Giriş, kullanıcı adı ve şikayet pencereleri (hepsi document.body'ye çizilir) */
export function CommentThreadDialogs({ thread }: { thread: CommentThread }) {
  const { session, profile } = thread;
  return (
    <>
      {thread.showAuth && (
        <AuthModalPortal
          onClose={() => thread.setShowAuth(false)}
          onAuthenticated={() => {
            thread.setShowAuth(false);
            thread.setComposerError(null);
          }}
        />
      )}
      {thread.needsUsername && session && (
        <UsernameSheet
          mode="onboarding"
          intro="Yorumlar herkese açık: yorum yapmak için önce bir kullanıcı adı seç; yorumun bu adla görünür."
          initialValue={suggestUsername(profile?.displayName ?? suggestedDisplayName(session.user.user_metadata), session.user.email)}
          onClose={() => thread.setNeedsUsername(false)}
          onSaved={() => {
            thread.setNeedsUsername(false);
            thread.setComposerError(null);
          }}
        />
      )}
      {thread.reporting && (
        <CommentReportSheet
          comment={thread.reporting}
          onClose={() => thread.setReporting(null)}
          onReported={thread.markReported}
        />
      )}
    </>
  );
}

function CommentSkeleton({ tone }: { tone: CommentTone }) {
  const bar = TONES[tone].skeleton;
  return (
    <>
      {[0, 1, 2].map((i) => (
        <li key={i} aria-hidden="true" className="flex gap-3 py-3 motion-safe:animate-pulse">
          <span className={`h-9 w-9 shrink-0 rounded-full ${bar}`} />
          <span className="flex-1 space-y-2 pt-1">
            <span className={`block h-3 w-28 rounded ${bar}`} />
            <span className={`block h-3.5 w-4/5 rounded ${bar}`} />
          </span>
        </li>
      ))}
    </>
  );
}
