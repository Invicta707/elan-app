"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSupabaseSession } from "../../lib/auth";
import {
  appendComments,
  cleanComment,
  commentError,
  deleteComment,
  fetchComments,
  postComment,
  prependComment,
  replaceComment,
  type CommentCursor,
  type DisplayComment,
} from "../../lib/comments";
import { useMyProfile } from "../../lib/use-my-profile";

// Bir ilanın yorumları: yükleme, sayfalama, iyimser gönderim ve silme, şikayet.
// Mobildeki yorum penceresi (CommentsSheet) ve masaüstündeki yan panel
// (DesktopFeedPanel) aynı davranışı bu kancadan alır; yalnızca görünümleri farklı.
// Kurallar ve istekler: lib/comments.ts, /api/vehicles/[id]/comments.

export type CommentLoad = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

export function useCommentThread({
  vehicleId,
  initialTotal,
  onTotalChange,
}: {
  vehicleId: string;
  initialTotal: number;
  /** Akış kartındaki sayaç anında güncellensin */
  onTotalChange?: (total: number) => void;
}) {
  const localSeq = useRef(0);
  const { session, isLoading: sessionLoading } = useSupabaseSession();
  const { profile } = useMyProfile();

  const [load, setLoad] = useState<CommentLoad>({ status: "loading" });
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
  /** Şikayet penceresi açık olan yorum */
  const [reporting, setReporting] = useState<DisplayComment | null>(null);
  /** Bu oturumda şikayet edilen yorumlar (satırda "Şikayet edildi") */
  const [reported, setReported] = useState<ReadonlySet<string>>(() => new Set());

  const accessToken = session?.access_token ?? null;
  const myId = session?.user.id ?? null;

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

  const reload = useCallback(() => {
    setLoad({ status: "loading" });
    setReloadKey((key) => key + 1);
  }, []);

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

  /** true: iyimser olarak listeye eklendi (liste başa kaydırılabilir) */
  async function send(content: string): Promise<boolean> {
    setComposerError(null);
    const invalid = commentError(content);
    if (invalid) {
      setComposerError(invalid);
      return false;
    }
    if (!session) {
      setShowAuth(true);
      return false;
    }
    if (profile && !profile.username) {
      setNeedsUsername(true);
      return false;
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

    void (async () => {
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
    })();
    return true;
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

  function markReported(commentId: string) {
    setReported((current) => new Set(current).add(commentId));
  }

  return {
    vehicleId,
    session,
    sessionLoading,
    profile,
    load,
    comments,
    total,
    cursor,
    loadingMore,
    loadMore,
    reload,
    text,
    setText,
    composerError,
    setComposerError,
    listError,
    confirmingDelete,
    setConfirmingDelete,
    send,
    retry,
    remove,
    showAuth,
    setShowAuth,
    needsUsername,
    setNeedsUsername,
    reporting,
    setReporting,
    reported,
    markReported,
  };
}

export type CommentThread = ReturnType<typeof useCommentThread>;
