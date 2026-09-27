"use client";

import { ArrowUp, LoaderCircle, MessageCircle, X } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { bodyFont, displayFont } from "../../app/fonts";
import { useSupabaseSession } from "../../lib/auth";
import {
  COMMENT_MAX_LENGTH,
  appendComments,
  cleanComment,
  commentAuthorName,
  commentError,
  deleteComment,
  fetchComments,
  formatCommentTime,
  postComment,
  prependComment,
  replaceComment,
  type CommentCursor,
  type DisplayComment,
} from "../../lib/comments";
import { suggestedDisplayName } from "../../lib/profile";
import { useMyProfile } from "../../lib/use-my-profile";
import { profilePath, suggestUsername } from "../../lib/username";
import { AuthModalPortal } from "../AuthGatedLink";
import UsernameSheet from "../profile/UsernameSheet";
import Avatar from "../ui/Avatar";

// Akışta video altı yorumlar: alttan açılan pencere (ekranın en fazla ~%70'i).
// Video arkada hafif kararmış halde oynamaya devam eder. Yerel <dialog>: odak
// içeride kalır; Esc, Android geri hareketi, dışarı dokunma ve tutamaçtan aşağı
// kaydırma kapatır. document.body'ye çizilir: akış katmanının
// pointer-events-none alanından etkilenmez. Mobil klavye açılınca pencere
// görünür alana (visualViewport) oturur, yazma alanı klavyenin üstünde kalır.
// Kurallar ve istekler: lib/comments.ts, /api/vehicles/[id]/comments.

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

/** Kapatmak için tutamaçtan aşağı sürükleme mesafesi (px) */
const DRAG_CLOSE_DISTANCE = 110;

/** Klavye yüksekliği ve görünür alan (klavye yokken inset 0) */
function useKeyboardInset() {
  const [state, setState] = useState<{ inset: number; height: number } | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      setState({ inset, height: viewport.height });
    };
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return state;
}

export default function CommentsSheet({
  vehicleId,
  initialTotal,
  onTotalChange,
  onClose,
}: {
  vehicleId: string;
  initialTotal: number;
  /** Akış kartındaki sayaç anında güncellensin */
  onTotalChange?: (total: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const sentinelRef = useRef<HTMLLIElement>(null);
  const drag = useRef<{ startY: number; dy: number } | null>(null);
  const localSeq = useRef(0);

  const { session, isLoading: sessionLoading } = useSupabaseSession();
  const { profile } = useMyProfile();
  const keyboard = useKeyboardInset();

  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [comments, setComments] = useState<DisplayComment[]>([]);
  const [total, setTotal] = useState(initialTotal);
  const [cursor, setCursor] = useState<CommentCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [text, setText] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [needsUsername, setNeedsUsername] = useState(false);

  const accessToken = session?.access_token ?? null;
  const myId = session?.user.id ?? null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const changeTotal = useCallback((delta: number) => setTotal((current) => Math.max(0, current + delta)), []);

  // Akış kartındaki sayaç pencereyle birlikte değişir
  useEffect(() => {
    onTotalChange?.(total);
  }, [total, onTotalChange]);

  // Token saatlik yenilenir; liste bu yüzden baştan yüklenmesin diye ref'ten okunur
  const tokenRef = useRef(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  // İlk sayfa: oturum bilinince (silme hakları oturuma göre gelir)
  useEffect(() => {
    if (sessionLoading) return;
    let active = true;
    void (async () => {
      const result = await fetchComments(vehicleId, { accessToken: tokenRef.current });
      if (!active) return;
      if (!result.ok) {
        setLoad({ status: "error", message: result.message });
        return;
      }
      setComments(result.page.comments);
      setCursor(result.page.nextCursor);
      setTotal(result.page.total);
      setLoad({ status: "ready" });
    })();
    return () => {
      active = false;
    };
    // Oturum sahibi değişince (giriş/çıkış) silme hakları için baştan yüklenir
  }, [vehicleId, myId, sessionLoading, reloadKey]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const result = await fetchComments(vehicleId, { cursor, accessToken: tokenRef.current });
    setLoadingMore(false);
    if (!result.ok) {
      setListError(result.message);
      return;
    }
    setComments((list) => appendComments(list, result.page.comments));
    setCursor(result.page.nextCursor);
  }, [cursor, loadingMore, vehicleId]);

  // Listenin sonuna gelince sonraki sayfa
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const list = listRef.current;
    if (!sentinel || !list || !cursor || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { root: list, rootMargin: "120px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  async function send(content: string) {
    setComposerError(null);
    const invalid = commentError(content);
    if (invalid) {
      setComposerError(invalid);
      return;
    }
    if (!session) {
      setShowAuth(true);
      return;
    }
    if (profile && !profile.username) {
      setNeedsUsername(true);
      return;
    }

    const clean = cleanComment(content);
    localSeq.current += 1;
    const localId = `local-${localSeq.current}`;
    const local: DisplayComment = {
      id: localId,
      userId: session.user.id,
      content: clean,
      createdAt: new Date().toISOString(),
      username: profile?.username ?? null,
      displayName: profile?.displayName ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
      isSeller: false,
      isMine: true,
      canDelete: false,
      pending: "sending",
    };
    setComments((list) => prependComment(list, local));
    changeTotal(1);
    setText("");
    listRef.current?.scrollTo({ top: 0, behavior: "smooth" });

    const result = await postComment(vehicleId, clean, session.access_token);
    if (result.ok) {
      setComments((list) => replaceComment(list, localId, result.comment));
      return;
    }
    changeTotal(-1);
    // Ağ ya da sunucu hatası: yorum listede kalır, tekrar denenebilir
    if (result.status === 0 || result.status >= 500) {
      setComments((list) => list.map((item) => (item.id === localId ? { ...item, pending: "failed" } : item)));
      return;
    }
    // Kural, sınır ya da yetki: yorum listeden çıkar, metin kutuya döner
    setComments((list) => list.filter((item) => item.id !== localId));
    setText((current) => current || clean);
    setComposerError(result.message);
    if (result.code === "username_required") setNeedsUsername(true);
    if (result.status === 401) setShowAuth(true);
  }

  function retry(comment: DisplayComment) {
    setComments((list) => list.filter((item) => item.id !== comment.id));
    void send(comment.content);
  }

  async function remove(comment: DisplayComment) {
    setConfirmingDelete(null);
    setListError(null);
    if (comment.pending) {
      setComments((list) => list.filter((item) => item.id !== comment.id));
      return;
    }
    if (!accessToken) return;
    const index = comments.findIndex((item) => item.id === comment.id);
    setComments((list) => list.filter((item) => item.id !== comment.id));
    changeTotal(-1);
    const result = await deleteComment(vehicleId, comment.id, accessToken);
    // 404: zaten silinmiş
    if (!result.ok && result.status !== 404) {
      setComments((list) => [...list.slice(0, Math.max(0, index)), comment, ...list.slice(Math.max(0, index))]);
      changeTotal(1);
      setListError(result.message);
    }
  }

  // Tutamaçtan aşağı sürükleyince kapanır
  function onDragStart(event: ReactPointerEvent<HTMLDivElement>) {
    drag.current = { startY: event.clientY, dy: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onDragMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current || !sheetRef.current) return;
    drag.current.dy = Math.max(0, event.clientY - drag.current.startY);
    sheetRef.current.style.transform = `translateY(${drag.current.dy}px)`;
    sheetRef.current.style.transition = "none";
  }
  function onDragEnd() {
    const moved = drag.current?.dy ?? 0;
    drag.current = null;
    if (!sheetRef.current) return;
    sheetRef.current.style.transition = "transform 180ms ease-out";
    if (moved > DRAG_CLOSE_DISTANCE) {
      onClose();
      return;
    }
    sheetRef.current.style.transform = "";
  }

  const keyboardOpen = Boolean(keyboard && keyboard.inset > 0);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby="comments-title"
      onCancel={(event) => {
        // İçteki pencerenin (giriş, kullanıcı adı) kapanışı React ağacında buraya da
        // iletilir; yalnızca bu pencerenin kendi Esc / geri hareketi kapatır
        if (event.target !== dialogRef.current) return;
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      style={{ bottom: keyboard?.inset ?? 0 }}
      className={`${displayFont.variable} ${bodyFont.variable} fixed inset-x-0 top-auto m-0 w-full max-w-none bg-transparent p-0 [font-family:var(--font-body)] backdrop:bg-black/35`}
    >
      <div
        ref={sheetRef}
        style={{ height: keyboardOpen && keyboard ? `${Math.max(240, keyboard.height - 12)}px` : undefined }}
        className="mx-auto flex h-[min(70dvh,640px)] w-full max-w-lg flex-col rounded-t-3xl bg-white text-[#15181C] shadow-[0_-8px_32px_rgba(0,0,0,0.18)] motion-safe:animate-[sheet-up_240ms_cubic-bezier(0.22,1,0.36,1)]"
      >
        {/* Tutamaç + başlık: aşağı sürükleyince kapanır */}
        <div
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          className="relative shrink-0 cursor-grab touch-none select-none border-b border-[#EEF0F3] pb-2"
        >
          <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[#D5D9DF]" />
          <h2 id="comments-title" className="mt-2 text-center text-[15px] font-semibold">
            {total > 0 ? `${total.toLocaleString("tr-TR")} yorum` : "Yorumlar"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            onPointerDown={(event) => event.stopPropagation()}
            aria-label="Yorumları kapat"
            className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full text-[#5B616B] hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <ul ref={listRef} aria-label="Yorumlar" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
          {load.status === "loading" && <CommentSkeleton />}
          {load.status === "error" && (
            <li role="status" className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-[14.5px] text-[#5B616B]">{load.message}</p>
              <button
                type="button"
                onClick={() => {
                  setLoad({ status: "loading" });
                  setReloadKey((k) => k + 1);
                }}
                className="h-10 rounded-full bg-[#F2F3F5] px-5 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
              >
                Tekrar dene
              </button>
            </li>
          )}
          {load.status === "ready" && comments.length === 0 && (
            <li className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F2F3F5] text-[#5B616B]">
                <MessageCircle aria-hidden="true" className="h-6 w-6" />
              </span>
              <p className="text-[15.5px] font-semibold">Henüz yorum yok</p>
              <p className="max-w-[16rem] text-[14px] text-[#5B616B]">İlk yorumu sen yap!</p>
            </li>
          )}
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              confirming={confirmingDelete === comment.id}
              onAskDelete={() => setConfirmingDelete(comment.id)}
              onCancelDelete={() => setConfirmingDelete(null)}
              onDelete={() => void remove(comment)}
              onRetry={() => retry(comment)}
            />
          ))}
          {load.status === "ready" && cursor && (
            <li ref={sentinelRef} className="flex justify-center py-3">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13.5px] font-semibold text-[#5B616B] hover:bg-black/5 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
              >
                {loadingMore && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
                {loadingMore ? "Yükleniyor…" : "Daha fazla yorum"}
              </button>
            </li>
          )}
        </ul>

        <div role="status" aria-live="polite">
          {listError && <p className="mx-4 mb-1 rounded-lg bg-[#FDEDEC] px-3 py-2 text-[13px] text-[#B42318]">{listError}</p>}
        </div>

        {session ? (
          <CommentComposer
            text={text}
            onTextChange={(value) => {
              setText(value);
              if (composerError) setComposerError(null);
            }}
            onSend={(value) => void send(value)}
            error={composerError}
            avatarUrl={profile?.avatarUrl ?? null}
            name={profile?.displayName ?? profile?.username ?? session.user.email ?? null}
            keyboardOpen={keyboardOpen}
          />
        ) : (
          <div className="shrink-0 border-t border-[#EEF0F3] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => setShowAuth(true)}
              disabled={sessionLoading}
              className="h-12 w-full rounded-full bg-[#003399] text-[15.5px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/30"
            >
              Yorum yapmak için giriş yap
            </button>
          </div>
        )}
      </div>

      {showAuth && (
        <AuthModalPortal
          onClose={() => setShowAuth(false)}
          onAuthenticated={() => {
            setShowAuth(false);
            setComposerError(null);
          }}
        />
      )}
      {needsUsername && session && (
        <UsernameSheet
          mode="onboarding"
          intro="Yorumlar herkese açık: yorum yapmak için önce bir kullanıcı adı seç; yorumun bu adla görünür."
          initialValue={suggestUsername(profile?.displayName ?? suggestedDisplayName(session.user.user_metadata), session.user.email)}
          onClose={() => setNeedsUsername(false)}
          onSaved={() => {
            setNeedsUsername(false);
            setComposerError(null);
          }}
        />
      )}
    </dialog>,
    document.body,
  );
}

export function CommentRow({
  comment,
  confirming,
  onAskDelete,
  onCancelDelete,
  onDelete,
  onRetry,
}: {
  comment: DisplayComment;
  confirming: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onRetry: () => void;
}) {
  const name = commentAuthorName(comment);
  const profileHref = comment.username ? profilePath(comment.username) : null;
  const avatar = <Avatar url={comment.avatarUrl} name={comment.displayName ?? comment.username} size={36} />;

  return (
    <li className={`flex gap-3 py-3 ${comment.pending === "sending" ? "opacity-60" : ""}`}>
      {profileHref ? (
        <Link href={profileHref} aria-label={`${name} vitrini`} className="shrink-0 self-start rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]">
          {avatar}
        </Link>
      ) : (
        <span className="shrink-0 self-start">{avatar}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] leading-5">
          {profileHref ? (
            <Link href={profileHref} className="truncate font-semibold text-[#4A5058] hover:underline focus-visible:outline-none focus-visible:underline">
              {name}
            </Link>
          ) : (
            <span className="truncate font-semibold text-[#4A5058]">{name}</span>
          )}
          {comment.isSeller && (
            <span className="rounded bg-[#EAEFF7] px-1.5 py-px text-[11px] font-semibold text-[#003399]">Satıcı</span>
          )}
          <time dateTime={comment.createdAt} className="text-[#8A9099]">
            · {comment.pending === "sending" ? "gönderiliyor…" : formatCommentTime(comment.createdAt)}
          </time>
        </p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-snug text-[#15181C]">{comment.content}</p>

        {comment.pending === "failed" && (
          <p className="mt-1 text-[12.5px] text-[#B42318]">
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
            <span className="text-[#4A5058]">Yorum silinsin mi?</span>
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
              className="h-8 rounded-full bg-[#F2F3F5] px-3 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
            >
              Vazgeç
            </button>
          </div>
        )}
      </div>
      {comment.canDelete && !comment.pending && !confirming && (
        <button
          type="button"
          onClick={onAskDelete}
          aria-label={`${name} yorumunu sil`}
          className="h-8 shrink-0 self-start rounded-full px-2 text-[12.5px] font-semibold text-[#8A9099] hover:bg-black/5 hover:text-[#B42318] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
        >
          Sil
        </button>
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
  keyboardOpen = false,
}: {
  text: string;
  onTextChange: (value: string) => void;
  onSend: (value: string) => void;
  error: string | null;
  avatarUrl: string | null;
  name: string | null;
  keyboardOpen?: boolean;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const clean = cleanComment(text);
  const canSend = clean.length > 0 && clean.length <= COMMENT_MAX_LENGTH;

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 120)}px`;
  }, [text]);

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
      className={`shrink-0 border-t border-[#EEF0F3] bg-white px-3 pt-2 ${keyboardOpen ? "pb-2" : "pb-[max(0.5rem,env(safe-area-inset-bottom))]"}`}
    >
      {error && (
        <p role="alert" className="mb-1.5 px-1 text-[13px] font-medium text-[#B42318]">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2">
        <Avatar url={avatarUrl} name={name} size={32} className="mb-1.5 shrink-0" />
        <div className="flex flex-1 items-end gap-1 rounded-[22px] border border-[#D5D9DF] bg-white py-0.5 pr-0.5 pl-3.5 transition-[border-color,box-shadow] focus-within:border-[#003399] focus-within:ring-4 focus-within:ring-[#003399]/10">
          <label htmlFor="comment-composer" className="sr-only">
            Yorum yaz
          </label>
          <textarea
            id="comment-composer"
            ref={areaRef}
            rows={1}
            value={text}
            maxLength={COMMENT_MAX_LENGTH}
            placeholder="Yorum ekle…"
            enterKeyHint="send"
            onChange={(event) => onTextChange(event.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-[38px] flex-1 resize-none bg-transparent py-2 text-[16px] leading-[1.35] text-[#15181C] outline-none placeholder:text-[#9AA0A8]"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Gönder"
            className={`mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-[transform,background-color,opacity] duration-150 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2 ${
              canSend ? "bg-[#003399]" : "bg-[#9AA8C8] opacity-70"
            }`}
          >
            <ArrowUp aria-hidden="true" className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </div>
      </div>
      {text.length > COMMENT_MAX_LENGTH - 100 && (
        <p className="mt-1 pr-1 text-right text-[12px] tabular-nums text-[#8A9099]">
          {text.length}/{COMMENT_MAX_LENGTH}
        </p>
      )}
    </form>
  );
}

function CommentSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <li key={i} aria-hidden="true" className="flex gap-3 py-3 motion-safe:animate-pulse">
          <span className="h-9 w-9 shrink-0 rounded-full bg-[#EEF0F3]" />
          <span className="flex-1 space-y-2 pt-1">
            <span className="block h-3 w-28 rounded bg-[#EEF0F3]" />
            <span className="block h-3.5 w-4/5 rounded bg-[#EEF0F3]" />
          </span>
        </li>
      ))}
    </>
  );
}
