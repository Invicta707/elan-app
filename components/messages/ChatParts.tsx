"use client";

import { ArrowUp, Check, CheckCheck, ChevronLeft, ChevronRight, Clock, CircleAlert, MoreVertical } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  MAX_MESSAGE_LENGTH,
  cleanMessage,
  counterpartRole,
  partnerHandle,
  partnerName,
  timeLabel,
  type ChatMessage,
  type ConversationDetail,
} from "../../lib/messages";
import { formatTilePrice } from "../../lib/showcase";
import { profilePath } from "../../lib/username";
import Avatar from "../ui/Avatar";

// Sohbet ekranının sunum parçaları (veri ve Realtime: ChatView).

export function ReadTicks({ message }: { message: ChatMessage }) {
  if (message.failed) return <CircleAlert aria-hidden="true" className="h-3.5 w-3.5 text-[#FFD0CC]" />;
  if (message.pending) return <Clock aria-hidden="true" className="h-3 w-3" />;
  if (message.isRead) return <CheckCheck aria-hidden="true" className="h-3.5 w-3.5 text-[#9ED8FF]" />;
  return <Check aria-hidden="true" className="h-3.5 w-3.5" />;
}

function statusText(message: ChatMessage): string {
  if (message.failed) return "gönderilemedi";
  if (message.pending) return "gönderiliyor";
  return message.isRead ? "okundu" : "gönderildi";
}

export function MessageBubble({
  message,
  mine,
  groupStart,
  groupEnd,
  onRetry,
}: {
  message: ChatMessage;
  mine: boolean;
  groupStart: boolean;
  groupEnd: boolean;
  onRetry?: (message: ChatMessage) => void;
}) {
  const time = timeLabel(message.createdAt);
  // Aynı kişinin ardışık balonları birbirine yakın köşelerle bağlanır; grubun sonu "kuyruk"
  const shape = mine
    ? `rounded-[20px] rounded-br-[6px] ${groupStart ? "" : "rounded-tr-[6px]"}`
    : `rounded-[20px] rounded-bl-[6px] ${groupStart ? "" : "rounded-tl-[6px]"}`;
  const tone = mine
    ? "bg-[#003399] text-white"
    : "bg-[#EEF0F3] text-[#15181C]";

  return (
    <li
      data-mine={mine || undefined}
      className={`flex ${mine ? "justify-end" : "justify-start"} ${groupStart ? "mt-2.5" : "mt-[3px]"} ${groupEnd ? "" : ""}`}
    >
      <div
        className={`relative max-w-[78%] px-3.5 pt-2 pb-1.5 text-[15.5px] leading-[1.35] motion-safe:animate-[bubble-in_180ms_ease-out] ${shape} ${tone} ${
          message.pending ? "opacity-80" : ""
        }`}
      >
        <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.text}</span>
        {/* Saat ve tikler metnin sonuna oturur (sığmazsa alt satıra) */}
        <span
          className={`float-right ml-2 mt-1.5 inline-flex translate-y-0.5 items-center gap-0.5 text-[10.5px] tabular-nums ${
            mine ? "text-white/75" : "text-[#8A9099]"
          }`}
        >
          {time}
          {mine && <ReadTicks message={message} />}
        </span>
        <span className="sr-only">
          {mine ? "Sen" : "Karşı taraf"}, {time}
          {mine ? `, ${statusText(message)}` : ""}
        </span>
        {message.failed && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(message)}
            className="mt-1 block text-[12.5px] font-semibold text-[#FFD0CC] underline underline-offset-2"
          >
            Gönderilemedi · Tekrar dene
          </button>
        )}
      </div>
    </li>
  );
}

export function DaySeparator({ label }: { label: string }) {
  return (
    <li className="my-3 flex justify-center" role="separator" aria-label={label}>
      <span className="rounded-full bg-white/80 px-3 py-1 text-[12px] font-semibold text-[#5B616B] shadow-[0_1px_2px_rgba(16,24,40,0.06)] backdrop-blur">
        {label}
      </span>
    </li>
  );
}

export function ChatHeader({
  detail,
  onBack,
  onMenu,
}: {
  detail: ConversationDetail;
  onBack: () => void;
  onMenu: () => void;
}) {
  const direct = detail.kind === "direct";
  // Başlık: görünen ad, yoksa @kullanıcı_adı (ilanlı sohbette o da yoksa rol)
  const name = partnerName(detail.partner, direct ? undefined : detail.role);
  const username = detail.partner.username ?? null;
  // Profilden başlatılan (doğrudan) sohbette ilan kartı ve Alıcı/Satıcı rolü yok
  const listing = direct ? null : detail.listing;
  const live = listing?.status === "active";
  // Alt satır: ad varsa küçük gri @kullanıcı_adı; ilanlı sohbette rol (başlıkta yoksa)
  const role = direct ? null : counterpartRole(detail.role);
  const subtitle = [partnerHandle(detail.partner), role !== name ? role : null].filter(Boolean).join(" · ");
  const identity = (
    <>
      <Avatar url={detail.partner.avatarUrl} name={name} size={38} />
      <span className="ml-2 min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold leading-tight">{name}</span>
        {subtitle && <span className="block truncate text-[12.5px] text-[#71717A]">{subtitle}</span>}
      </span>
    </>
  );

  const card = listing && (
    <span className="flex items-center gap-2.5 rounded-2xl bg-[#F2F3F5] p-1.5 pr-3">
      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-[#DDE1E6]">
        {listing.coverUrl && <Image src={listing.coverUrl} alt="" fill sizes="44px" className="object-cover" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-[#15181C]">{listing.title}</span>
        <span className="block text-[13px] font-bold tabular-nums text-[#003399]">
          {formatTilePrice(listing.price, listing.currency)}
          {!live && <span className="ml-1.5 font-medium text-[#8A9099]">· Yayında değil</span>}
        </span>
      </span>
      {live && <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[#8A9099]" />}
    </span>
  );

  return (
    <header className="shrink-0 border-b border-black/5 bg-white/90 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 backdrop-blur-xl">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="Mesajlara dön"
          className="flex h-11 w-11 items-center justify-center rounded-full transition-transform active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
        >
          <ChevronLeft aria-hidden="true" className="h-7 w-7" />
        </button>
        {/* Ad ve avatar kullanıcının vitrinine gider (kullanıcı adı varsa) */}
        <h1 className="flex min-w-0 flex-1">
          {username ? (
            <Link
              href={profilePath(username)}
              aria-label={`${name} vitrini`}
              className="flex min-w-0 flex-1 items-center rounded-xl py-0.5 pr-1 transition-colors hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
            >
              {identity}
            </Link>
          ) : (
            <span className="flex min-w-0 flex-1 items-center">{identity}</span>
          )}
        </h1>
        <button
          type="button"
          onClick={onMenu}
          aria-label="Sohbet seçenekleri"
          aria-haspopup="dialog"
          className="flex h-11 w-11 items-center justify-center rounded-full transition-transform active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
        >
          <MoreVertical aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      {card && (
        <div className="mt-1.5 px-1">
          {live ? (
            <Link
              href={`/vehicles/${listing.id}`}
              className="block rounded-2xl transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
            >
              {card}
            </Link>
          ) : (
            card
          )}
        </div>
      )}
    </header>
  );
}

const MAX_COMPOSER_HEIGHT = 132;

export function Composer({ onSend, onFocus }: { onSend: (text: string) => void; onFocus?: () => void }) {
  const [text, setText] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const clean = cleanMessage(text);
  const canSend = clean.length > 0 && clean.length <= MAX_MESSAGE_LENGTH;

  // Yazdıkça büyür (en fazla ~5 satır), sonra kendi içinde kayar
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [text]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    onSend(clean);
    setText("");
    areaRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Masaüstünde Enter gönderir (Shift+Enter yeni satır); dokunmatikte Enter yeni satırdır
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      if (window.matchMedia("(pointer: fine)").matches) submit(event);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="shrink-0 border-t border-black/5 bg-white/95 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-xl"
    >
      <div className="flex items-end gap-2 rounded-[26px] border border-[#D5D9DF] bg-white py-1 pr-1 pl-4 transition-[border-color,box-shadow] focus-within:border-[#003399] focus-within:ring-4 focus-within:ring-[#003399]/10">
        <label htmlFor="chat-composer" className="sr-only">
          Mesaj yaz
        </label>
        <textarea
          id="chat-composer"
          ref={areaRef}
          rows={1}
          value={text}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Mesaj yaz…"
          enterKeyHint="send"
          onFocus={onFocus}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          className="min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[16px] leading-[1.4] text-[#15181C] outline-none placeholder:text-[#9AA0A8]"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Gönder"
          className={`mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-[transform,background-color,opacity] duration-150 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2 ${
            canSend ? "bg-[#003399] opacity-100" : "bg-[#9AA8C8] opacity-70"
          }`}
        >
          <ArrowUp aria-hidden="true" className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>
    </form>
  );
}
