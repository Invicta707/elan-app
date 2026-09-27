"use client";

import { MessageCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import AuthModal from "../AuthModal";
import FeedHeader from "../FeedHeader";
import { useSupabaseSession } from "../../lib/auth";
import {
  inboxTimeLabel,
  listConversations,
  partnerName,
  type ConversationSummary,
} from "../../lib/messages";
import { supabase } from "../../lib/supabase";
import Avatar from "../ui/Avatar";

// /messages: gelen kutusu (Instagram Direct gibi). Yeni mesaj gelince liste
// Realtime ile yenilenir; en son konuşulan en üstte.
export default function InboxView() {
  const { session, isLoading } = useSupabaseSession();
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <>
      <FeedHeader activeTab="my-listings" tone="solid" />
      <div className="mx-auto max-w-2xl px-2 pt-1 pb-[max(2.5rem,calc(var(--bottom-nav-height)+1.5rem))] sm:px-4">
        <h1 className="px-2 text-[24px] font-semibold [font-family:var(--font-display)]">Mesajlar</h1>
        {isLoading ? (
          <InboxSkeleton />
        ) : session ? (
          <Inbox key={session.user.id} myId={session.user.id} />
        ) : (
          <div className="mt-14 flex flex-col items-center gap-4 text-center">
            <p className="max-w-xs text-[15px] text-[#5B616B]">Satıcılarla ve alıcılarla yazışmalarını görmek için giriş yap.</p>
            <button
              type="button"
              onClick={() => setShowAuthModal(true)}
              className="h-12 rounded-2xl bg-[#003399] px-7 text-[16px] font-semibold text-white transition-transform active:scale-[0.98]"
            >
              Giriş yap
            </button>
          </div>
        )}
      </div>
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} onAuthenticated={() => setShowAuthModal(false)} />}
    </>
  );
}

function Inbox({ myId }: { myId: string }) {
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      listConversations()
        .then((list) => {
          if (!active) return;
          setItems(list);
          setError(false);
        })
        .catch((err) => {
          console.error("Mesajlar yüklenemedi:", err);
          if (active) setError(true);
        });
    void load();

    const channel = supabase
      .channel(`inbox:${myId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(load, 300);
      })
      .subscribe();
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [myId]);

  if (error && !items) return <p className="mt-10 text-center text-[15px] text-[#5B616B]">Mesajlar yüklenemedi.</p>;
  if (!items) return <InboxSkeleton />;

  if (items.length === 0) {
    return (
      <div className="mt-12 flex flex-col items-center gap-3 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#15181C]">
          <MessageCircle aria-hidden="true" className="h-9 w-9" strokeWidth={1.6} />
        </span>
        <p className="text-[18px] font-semibold">Henüz mesajın yok</p>
        <p className="max-w-xs text-[14px] text-[#5B616B]">
          Beğendiğin bir ilanda &quot;Mesaj gönder&quot;e dokun; sohbetlerin burada görünür.
        </p>
        <Link href="/" className="mt-1 text-[15px] font-semibold text-[#003399]">
          İlanlara göz at
        </Link>
      </div>
    );
  }

  const now = new Date();
  return (
    <ul className="mt-2">
      {items.map((item) => {
        const name = partnerName(item.partner);
        const unread = item.unread > 0;
        const last = item.lastMessage;
        const preview = last ? `${last.senderId === myId ? "Sen: " : ""}${last.text}` : "Sohbeti başlat";
        return (
          <li key={item.id}>
            <Link
              href={`/messages/${item.id}`}
              className="flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-[background-color,transform] duration-150 hover:bg-white active:scale-[0.99] active:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
            >
              <span className="relative shrink-0">
                <Avatar url={item.partner.avatarUrl} name={name} size={56} />
                {item.listing?.coverUrl && (
                  <span className="absolute -bottom-1 -right-1 h-6 w-6 overflow-hidden rounded-lg border-2 border-[#F2F3F5] bg-[#DDE1E6]">
                    <Image src={item.listing.coverUrl} alt="" fill sizes="24px" className="object-cover" />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-[15.5px] ${unread ? "font-bold" : "font-semibold"}`}>{name}</span>
                  <span className={`shrink-0 text-[12.5px] tabular-nums ${unread ? "font-semibold text-[#003399]" : "text-[#8A9099]"}`}>
                    {inboxTimeLabel(last?.createdAt ?? item.updatedAt, now)}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-[#5B616B]">
                  {item.kind === "direct"
                    ? item.partner.username
                      ? `@${item.partner.username} · Doğrudan mesaj`
                      : "Doğrudan mesaj"
                    : (item.listing?.title ?? "İlan kaldırıldı")}
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className={`truncate text-[14px] ${unread ? "font-semibold text-[#15181C]" : "text-[#5B616B]"}`}>{preview}</span>
                  {unread && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#003399] px-1.5 text-[11px] font-bold text-white">
                      {item.unread > 99 ? "99+" : item.unread}
                      <span className="sr-only"> okunmamış mesaj</span>
                    </span>
                  )}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function InboxSkeleton() {
  return (
    <div aria-hidden="true" className="mt-3 space-y-3 px-2 motion-safe:animate-pulse">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-14 w-14 rounded-full bg-[#E3E6EA]" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 rounded bg-[#E3E6EA]" />
            <div className="h-3 w-2/3 rounded bg-[#E3E6EA]" />
          </div>
        </div>
      ))}
    </div>
  );
}
