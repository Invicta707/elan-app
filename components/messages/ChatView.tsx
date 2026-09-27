"use client";

import { Ban, Flag, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSupabaseSession } from "../../lib/auth";
import {
  blockUser,
  buildChatItems,
  fetchMessages,
  getConversation,
  markConversationRead,
  mergeMessages,
  partnerName,
  sendMessage,
  toChatMessage,
  unblockUser,
  type ChatMessage,
  type ConversationDetail,
  type MessageRow,
} from "../../lib/messages";
import { supabase } from "../../lib/supabase";
import { messagePolicyError } from "../../lib/text-moderation";
import { refreshUnreadCount } from "../../lib/use-unread-count";
import { ReportDialog } from "../ReportButton";
import BottomSheet from "../ui/BottomSheet";
import { ChatHeader, Composer, DaySeparator, MessageBubble } from "./ChatParts";
import ReportUserSheet from "./ReportUserSheet";

// /messages/[id]: tam ekran sohbet. Yeni mesajlar ve okundu bilgisi Supabase
// Realtime ile anında gelir. Kutu, görünür alana (visualViewport) oturur:
// mobilde klavye açılınca yazma alanı klavyenin hemen üstünde kalır.

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; detail: ConversationDetail };

/** Görünür alan (klavye açıkken küçülür); ilk çizimde tam ekran */
function useVisualViewportBox() {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setBox({ top: viewport.offsetTop, height: viewport.height });
    const frame = requestAnimationFrame(update);
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return box;
}

export default function ChatView({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const { session, isLoading } = useSupabaseSession();
  const myId = session?.user.id ?? null;
  const box = useVisualViewportBox();

  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<null | "menu" | "block" | "report-user" | "report-listing">(null);

  const listRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const initialScroll = useRef(true);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Yükleme: başlık + son mesajlar
  useEffect(() => {
    if (!myId) return;
    let active = true;
    Promise.all([getConversation(conversationId), fetchMessages(conversationId)])
      .then(([detail, list]) => {
        if (!active) return;
        setLoad({ status: "ready", detail });
        setMessages(list);
      })
      .catch((err) => active && setLoad({ status: "error", message: err instanceof Error ? err.message : "Konuşma açılamadı." }));
    return () => {
      active = false;
    };
  }, [conversationId, myId]);

  const markRead = useCallback(() => {
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      markConversationRead(conversationId)
        .then((changed) => changed > 0 && refreshUnreadCount())
        .catch((err) => console.error("Okundu bilgisi kaydedilemedi:", err));
    }, 300);
  }, [conversationId]);

  // Açılınca ve sekmeye dönülünce gelenleri okundu yap
  useEffect(() => {
    if (load.status !== "ready") return;
    markRead();
    const onVisible = () => document.visibilityState === "visible" && markRead();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load.status, markRead]);

  // Realtime: bu konuşmanın yeni mesajları ve okundu güncellemeleri
  useEffect(() => {
    if (!myId || load.status !== "ready") return;
    const filter = `conversation_id=eq.${conversationId}`;
    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter }, (payload) => {
        const message = toChatMessage(payload.new as MessageRow);
        setMessages((current) => mergeMessages(current, [message]));
        if (message.senderId !== myId) markRead();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter }, (payload) => {
        setMessages((current) => mergeMessages(current, [toChatMessage(payload.new as MessageRow)]));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, myId, load.status, markRead]);

  // Otomatik alta kaydırma: ilk açılışta hemen; yeni mesajda, alttaysa ya da kendi mesajınsa
  const lastMessage = messages[messages.length - 1];
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !lastMessage) return;
    if (initialScroll.current) {
      list.scrollTop = list.scrollHeight;
      initialScroll.current = false;
    } else if (nearBottom.current || lastMessage.senderId === myId) {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    }
  }, [lastMessage, myId]);

  // Klavye açılıp kapanınca (görünür alan değişince) alttaysa altta kal
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && nearBottom.current) list.scrollTop = list.scrollHeight;
  }, [box?.height]);

  async function send(text: string, retryOf?: ChatMessage) {
    if (!myId) return;
    setError(null);
    const tempId = `tmp-${crypto.randomUUID()}`;
    const optimistic: ChatMessage = {
      id: tempId,
      conversationId,
      senderId: myId,
      text,
      isRead: false,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setMessages((current) => mergeMessages(current.filter((m) => m.id !== retryOf?.id), [optimistic]));
    try {
      const saved = await sendMessage(conversationId, text);
      setMessages((current) => mergeMessages(current, [saved], { tempId }));
    } catch (err) {
      setMessages((current) => current.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)));
      setError(err instanceof Error ? err.message : "Mesaj gönderilemedi.");
    }
  }

  async function toggleBlock(detail: ConversationDetail) {
    if (!myId) return;
    setMenu(null);
    try {
      if (detail.iBlocked) await unblockUser(myId, detail.partner.id);
      else await blockUser(myId, detail.partner.id);
      setLoad({ status: "ready", detail: { ...detail, iBlocked: !detail.iBlocked } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "İşlem tamamlanamadı.");
    }
  }

  const frameStyle = box ? { top: box.top, height: box.height } : { top: 0, height: "100dvh" };

  if (!isLoading && !myId) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[16px] text-[#5B616B]">Mesajlarını görmek için giriş yap.</p>
        <Link href="/messages" className="h-12 rounded-2xl bg-[#003399] px-6 text-[16px] font-semibold leading-[3rem] text-white">
          Mesajlar
        </Link>
      </div>
    );
  }

  return (
    <div style={frameStyle} className="fixed inset-x-0 z-40 mx-auto flex max-w-2xl flex-col overscroll-none bg-[#F7F8FA]">
      {load.status === "ready" ? (
        <ChatHeader detail={load.detail} onBack={() => router.push("/messages")} onMenu={() => setMenu("menu")} />
      ) : (
        <div className="h-[110px] shrink-0 border-b border-black/5 bg-white" aria-hidden="true" />
      )}

      <div
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="flex-1 overflow-y-auto overscroll-contain px-3 pb-3"
      >
        {load.status === "loading" && (
          <div aria-hidden="true" className="mt-6 space-y-2 motion-safe:animate-pulse">
            <div className="h-9 w-2/3 rounded-[20px] bg-[#E3E6EA]" />
            <div className="ml-auto h-9 w-1/2 rounded-[20px] bg-[#DCE4F8]" />
            <div className="h-9 w-1/3 rounded-[20px] bg-[#E3E6EA]" />
          </div>
        )}
        {load.status === "error" && (
          <div role="alert" className="mt-16 flex flex-col items-center gap-3 text-center">
            <p className="text-[15px] text-[#5B616B]">{load.message}</p>
            <Link href="/messages" className="text-[15px] font-semibold text-[#003399]">
              Mesajlara dön
            </Link>
          </div>
        )}
        {load.status === "ready" && myId && (
          <>
            {messages.length === 0 && (
              <p className="mx-auto mt-10 max-w-xs text-center text-[14px] text-[#5B616B]">
                {partnerName(load.detail.partner, load.detail.kind === "direct" ? undefined : load.detail.role)} ile {load.detail.kind === "direct" ? "" : "bu ilan hakkında "}ilk mesajı
                sen gönder. Kişisel bilgilerini ve ödeme bilgilerini paylaşmamaya dikkat et.
              </p>
            )}
            <ol aria-label="Mesajlar" aria-live="polite" aria-relevant="additions">
              {buildChatItems(messages, myId).map((item) =>
                item.kind === "day" ? (
                  <DaySeparator key={item.key} label={item.label} />
                ) : (
                  <MessageBubble
                    key={item.key}
                    message={item.message}
                    mine={item.mine}
                    groupStart={item.groupStart}
                    groupEnd={item.groupEnd}
                    onRetry={(failed) => void send(failed.text, failed)}
                  />
                ),
              )}
            </ol>
          </>
        )}
      </div>

      <div role="status" aria-live="polite">
        {error && <p className="bg-[#FDEDEC] px-4 py-2 text-center text-[13px] text-[#B42318]">{error}</p>}
      </div>

      {load.status === "ready" &&
        (load.detail.iBlocked ? (
          <div className="shrink-0 border-t border-black/5 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center">
            <p className="text-[14px] text-[#5B616B]">Bu kullanıcıyı engelledin; mesajlaşamazsınız.</p>
            <button
              type="button"
              onClick={() => void toggleBlock(load.detail)}
              className="mt-1 text-[15px] font-semibold text-[#003399]"
            >
              Engeli kaldır
            </button>
          </div>
        ) : load.detail.blockedMe ? (
          <p className="shrink-0 border-t border-black/5 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-[14px] text-[#5B616B]">
            Bu sohbete artık mesaj gönderilemiyor.
          </p>
        ) : (
          <Composer
            onSend={(text) => {
              // Filtreye takılan mesaj balon olarak eklenmez; metin kutuda kalır, düzeltilebilir
              const policy = messagePolicyError(text);
              if (policy) {
                setError(policy);
                return false;
              }
              void send(text);
            }}
            onFocus={() => {
              nearBottom.current = true;
            }}
          />
        ))}

      {load.status === "ready" && menu === "menu" && (
        <BottomSheet
          title={partnerName(load.detail.partner, load.detail.role)}
          onClose={() => setMenu(null)}
          actions={[
            ...(load.detail.listing
              ? [{ label: "İlanı şikayet et", icon: <Flag className="h-5 w-5" />, onSelect: () => setMenu("report-listing") }]
              : []),
            {
              label: "Kullanıcıyı şikayet et",
              icon: <ShieldAlert className="h-5 w-5" />,
              onSelect: () => setMenu("report-user"),
            },
            load.detail.iBlocked
              ? { label: "Engeli kaldır", icon: <ShieldCheck className="h-5 w-5" />, onSelect: () => void toggleBlock(load.detail) }
              : {
                  label: "Kullanıcıyı engelle",
                  description: "Birbirinize mesaj gönderemezsiniz.",
                  icon: <Ban className="h-5 w-5" />,
                  tone: "danger" as const,
                  onSelect: () => setMenu("block"),
                },
          ]}
        />
      )}
      {load.status === "ready" && menu === "block" && (
        <BottomSheet title={`${partnerName(load.detail.partner, load.detail.role)} engellensin mi?`} onClose={() => setMenu(null)}>
          <div className="px-5 pb-2">
            <p className="text-center text-[15px] text-[#15181C]">
              Birbirinize mesaj gönderemezsiniz; bu kişi yeni bir sohbet de başlatamaz. Engeli istediğin zaman kaldırabilirsin.
            </p>
            <button
              type="button"
              onClick={() => void toggleBlock(load.detail)}
              className="mt-4 h-12 w-full rounded-2xl bg-[#D92D20] text-[16px] font-semibold text-white transition-transform active:scale-[0.98]"
            >
              Engelle
            </button>
          </div>
        </BottomSheet>
      )}
      {load.status === "ready" && menu === "report-user" && myId && (
        <ReportUserSheet
          reporterId={myId}
          userId={load.detail.partner.id}
          conversationId={conversationId}
          onClose={() => setMenu(null)}
        />
      )}
      {load.status === "ready" &&
        menu === "report-listing" &&
        load.detail.listing &&
        createPortal(<ReportDialog vehicleId={load.detail.listing.id} onClose={() => setMenu(null)} />, document.body)}
    </div>
  );
}
