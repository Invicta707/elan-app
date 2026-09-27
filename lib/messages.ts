import type { VehicleStatus } from "./listing-status";
import { supabase } from "./supabase";

// İlan üzerinden doğrudan mesajlaşma: tipler, veritabanı çağrıları ve saf
// yardımcılar (tarih etiketleri, balon gruplama, iyimser gönderim). UI'dan
// bağımsız. Yetkiler veritabanında: supabase/migrations/*_profiles_and_messaging.sql

export const MAX_MESSAGE_LENGTH = 2000;
export const DEFAULT_MEMBER_NAME = "gözüyle üyesi";

export type ListingSummary = {
  id: string;
  title: string;
  price: number;
  currency: string;
  status: VehicleStatus;
  coverUrl: string | null;
};

export type PublicProfile = {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** Varsa sohbetten vitrinine (/@kullanici_adi) gidilir */
  username?: string | null;
};

export type ConversationRole = "buyer" | "seller";

/** "listing": ilandan başlatıldı; "direct": profilden, ilana bağlı değil */
export type ConversationKind = "listing" | "direct";

export type ConversationSummary = {
  id: string;
  updatedAt: string;
  kind: ConversationKind;
  role: ConversationRole;
  listing: ListingSummary | null;
  partner: PublicProfile;
  lastMessage: { text: string; senderId: string; createdAt: string; isRead: boolean } | null;
  unread: number;
};

export type ConversationDetail = {
  id: string;
  kind: ConversationKind;
  role: ConversationRole;
  listing: ListingSummary | null;
  partner: PublicProfile;
  iBlocked: boolean;
  blockedMe: boolean;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  isRead: boolean;
  createdAt: string;
  /** İyimser gönderim: sunucu henüz onaylamadı */
  pending?: boolean;
  /** Gönderilemedi (tekrar denenebilir) */
  failed?: boolean;
};

// ---------------------------------------------------------------
// Veritabanı satırlarından dönüşüm
// ---------------------------------------------------------------

type Json = Record<string, unknown>;

function toListing(raw: unknown): ListingSummary | null {
  const row = raw as Json | null;
  if (!row?.id) return null;
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    price: Number(row.price ?? 0),
    currency: String(row.currency ?? "TRY"),
    status: row.status as VehicleStatus,
    coverUrl: (row.cover_url as string | null) ?? null,
  };
}

function toProfile(raw: unknown): PublicProfile {
  const row = (raw ?? {}) as Json;
  return {
    id: String(row.id ?? ""),
    displayName: (row.display_name as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    username: (row.username as string | null) ?? null,
  };
}

/** Eski yanıtta (kind yok) ilanı olan konuşma ilanlı sayılır */
function toKind(raw: unknown, listing: ListingSummary | null): ConversationKind {
  if (raw === "direct" || raw === "listing") return raw;
  return listing ? "listing" : "direct";
}

export function toConversationSummary(raw: unknown): ConversationSummary {
  const row = raw as Json;
  const last = row.last_message as Json | null;
  const listing = toListing(row.listing);
  return {
    id: String(row.id),
    updatedAt: String(row.updated_at),
    kind: toKind(row.kind, listing),
    role: row.role as ConversationRole,
    listing,
    partner: toProfile(row.partner),
    lastMessage: last
      ? {
          text: String(last.text),
          senderId: String(last.sender_id),
          createdAt: String(last.created_at),
          isRead: Boolean(last.is_read),
        }
      : null,
    unread: Number(row.unread ?? 0),
  };
}

export function toConversationDetail(raw: unknown): ConversationDetail {
  const row = raw as Json;
  const listing = toListing(row.listing);
  return {
    id: String(row.id),
    kind: toKind(row.kind, listing),
    role: row.role as ConversationRole,
    listing,
    partner: toProfile(row.partner),
    iBlocked: Boolean(row.i_blocked),
    blockedMe: Boolean(row.blocked_me),
  };
}

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  is_read: boolean;
  created_at: string;
};

export function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    text: row.text,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------
// Saf yardımcılar
// ---------------------------------------------------------------

export function partnerName(partner: Pick<PublicProfile, "displayName">): string {
  return partner.displayName?.trim() || DEFAULT_MEMBER_NAME;
}

export function cleanMessage(text: string): string {
  return text.trim();
}

export function messageError(text: string): string | null {
  const clean = cleanMessage(text);
  if (!clean) return "Mesaj boş olamaz.";
  if (clean.length > MAX_MESSAGE_LENGTH) return `Mesaj en fazla ${MAX_MESSAGE_LENGTH} karakter olabilir.`;
  return null;
}

/** Rozet metni: 0'da gösterilmez, 99'un üstü "99+" */
export function formatBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

/**
 * Mesaj listesine yeni ya da güncellenen mesajları ekler: aynı id tek kalır
 * (Realtime ile gelen, gönderimin cevabıyla aynı olabilir); iyimser mesaj
 * (tempId) sunucudaki karşılığı gelince yerini ona bırakır. Zamana göre sıralı.
 */
export function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
  replace?: { tempId: string },
): ChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  if (replace) byId.delete(replace.tempId);
  for (const message of incoming) {
    const existing = byId.get(message.id);
    // Okundu bilgisi geri dönmez (sırasız gelen olaylar)
    byId.set(message.id, existing ? { ...existing, ...message, isRead: existing.isRead || message.isRead } : message);
  }
  // Zaman sayısal karşılaştırılır: sunucu "…00.123456+00:00", iyimser mesaj "…00.123Z" biçiminde gelir
  return [...byId.values()].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
  );
}

const dayFormatter = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long" });
const dayWithYearFormatter = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
const shortDateFormatter = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "2-digit" });
const weekdayFormatter = new Intl.DateTimeFormat("tr-TR", { weekday: "long" });

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function daysBetween(date: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
}

export function timeLabel(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

/** Sohbetteki gün ayracı: "Bugün", "Dün", "12 Eylül", başka yılsa yıl da */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const days = daysBetween(date, now);
  if (days === 0) return "Bugün";
  if (days === 1) return "Dün";
  return (date.getFullYear() === now.getFullYear() ? dayFormatter : dayWithYearFormatter).format(date);
}

/** Gelen kutusundaki zaman: bugün saat, dün "Dün", bu hafta gün adı, sonra tarih */
export function inboxTimeLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const days = daysBetween(date, now);
  if (days <= 0) return timeFormatter.format(date);
  if (days === 1) return "Dün";
  if (days < 7) {
    const weekday = weekdayFormatter.format(date);
    return weekday.charAt(0).toLocaleUpperCase("tr") + weekday.slice(1);
  }
  return shortDateFormatter.format(date);
}

export type ChatItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "message"; key: string; message: ChatMessage; mine: boolean; groupStart: boolean; groupEnd: boolean };

/** Aynı kişinin 5 dakika içindeki ardışık mesajları tek grup (balon köşeleri buna göre) */
const GROUP_GAP_MS = 5 * 60_000;

export function buildChatItems(messages: readonly ChatMessage[], myId: string, now: Date = new Date()): ChatItem[] {
  const items: ChatItem[] = [];
  let lastDay = "";
  messages.forEach((message, index) => {
    const day = new Date(message.createdAt).toDateString();
    if (day !== lastDay) {
      items.push({ kind: "day", key: `day-${day}`, label: dayLabel(message.createdAt, now) });
      lastDay = day;
    }
    const previous = messages[index - 1];
    const next = messages[index + 1];
    const sameGroup = (a?: ChatMessage, b?: ChatMessage) =>
      Boolean(a && b) &&
      a!.senderId === b!.senderId &&
      new Date(a!.createdAt).toDateString() === new Date(b!.createdAt).toDateString() &&
      Math.abs(new Date(b!.createdAt).getTime() - new Date(a!.createdAt).getTime()) <= GROUP_GAP_MS;

    items.push({
      kind: "message",
      key: message.id,
      message,
      mine: message.senderId === myId,
      groupStart: !sameGroup(previous, message),
      groupEnd: !sameGroup(message, next),
    });
  });
  return items;
}

// ---------------------------------------------------------------
// Veritabanı çağrıları (oturumdaki kullanıcı adına; yetkiyi RLS ve RPC'ler denetler)
// ---------------------------------------------------------------

function fail(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

export async function startConversation(listingId: string): Promise<string> {
  const { data, error } = await supabase.rpc("start_conversation", { p_listing_id: listingId });
  if (error || !data) fail(error, "Mesajlaşma başlatılamadı.");
  return String(data);
}

/** Profilden doğrudan sohbet: kullanıcıyla konuşmayı açar ya da mevcut olanı döner */
export async function startDirectConversation(userId: string): Promise<string> {
  const { data, error } = await supabase.rpc("start_direct_conversation", { p_user_id: userId });
  if (error || !data) fail(error, "Mesajlaşma başlatılamadı.");
  return String(data);
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const { data, error } = await supabase.rpc("list_conversations");
  if (error) fail(error, "Mesajlar yüklenemedi.");
  return ((data ?? []) as unknown[]).map(toConversationSummary);
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  const { data, error } = await supabase.rpc("get_conversation", { p_conversation_id: id });
  if (error || !data) fail(error, "Konuşma bulunamadı.");
  return toConversationDetail(data);
}

export async function fetchMessages(conversationId: string, limit = 200): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, text, is_read, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail(error, "Mesajlar yüklenemedi.");
  return ((data ?? []) as MessageRow[]).map(toChatMessage).reverse();
}

export async function sendMessage(conversationId: string, senderId: string, text: string): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: senderId, text: cleanMessage(text) })
    .select("id, conversation_id, sender_id, text, is_read, created_at")
    .single();
  if (error || !data) {
    // RLS reddi: engel var ya da artık katılımcı değil
    if (error?.code === "42501") throw new Error("Bu sohbete mesaj gönderilemiyor.");
    fail(error, "Mesaj gönderilemedi.");
  }
  return toChatMessage(data as MessageRow);
}

export async function markConversationRead(conversationId: string): Promise<number> {
  const { data, error } = await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId });
  if (error) fail(error, "Okundu bilgisi kaydedilemedi.");
  return Number(data ?? 0);
}

export async function fetchUnreadCount(): Promise<number> {
  const { data, error } = await supabase.rpc("unread_message_count");
  if (error) fail(error, "Okunmamış mesajlar alınamadı.");
  return Number(data ?? 0);
}

export async function blockUser(myId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("user_blocks").insert({ blocker_id: myId, blocked_id: userId });
  if (error && error.code !== "23505") fail(error, "Kullanıcı engellenemedi.");
}

export async function unblockUser(myId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("user_blocks").delete().eq("blocker_id", myId).eq("blocked_id", userId);
  if (error) fail(error, "Engel kaldırılamadı.");
}

export const USER_REPORT_REASONS = {
  harassment: "Taciz, hakaret ya da tehdit",
  fraud: "Dolandırıcılık girişimi",
  spam: "Spam ya da istenmeyen mesaj",
  inappropriate: "Uygunsuz içerik",
  other: "Diğer",
} as const;

export type UserReportReason = keyof typeof USER_REPORT_REASONS;

/** "already": açık bir şikayetin zaten var */
export async function reportUser(input: {
  reporterId: string;
  userId: string;
  conversationId: string | null;
  reason: UserReportReason;
  details: string;
}): Promise<{ already: boolean }> {
  const details = input.details.trim().slice(0, 500) || null;
  const { error } = await supabase.from("user_reports").insert({
    reporter_id: input.reporterId,
    reported_user_id: input.userId,
    conversation_id: input.conversationId,
    reason: input.reason,
    details,
  });
  if (error?.code === "23505") return { already: true };
  if (error) fail(error, "Şikayet gönderilemedi.");
  return { already: false };
}
