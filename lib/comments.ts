import { isUuid } from "./feed";
import { commentPolicyError } from "./text-moderation";

// İlan yorumları: türler, metin kuralları, zaman gösterimi, imleç ve
// /api/vehicles/[id]/comments çağrıları. UI'dan bağımsız.
// Veritabanı kuralları: supabase/migrations/*_vehicle_comments.sql
// Sunucu tarafı: lib/comments-server.ts

export const COMMENT_MAX_LENGTH = 500;
export const COMMENTS_PAGE_SIZE = 20;
/** Sayfa en fazla; list_vehicle_comments 50'ye kadar verir, "daha var mı" için bir fazlası istenir */
export const COMMENTS_MAX_PAGE_SIZE = 40;

export type VehicleComment = {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** Yorumu ilanın sahibi yazdı ("Satıcı" etiketi) */
  isSeller: boolean;
  isMine: boolean;
  /** Oturumdaki kullanıcı silebilir: yazar, ilan sahibi ya da yönetici */
  canDelete: boolean;
};

export type CommentCursor = { before: string; beforeId: string };

export type CommentsPage = {
  /** İlanın toplam yorum sayısı (vehicles.comments_count) */
  total: number;
  /** En yenisi önce */
  comments: VehicleComment[];
  nextCursor: CommentCursor | null;
};

/** list_vehicle_comments satırı */
export type CommentRow = {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  is_seller?: boolean | null;
  is_mine?: boolean | null;
  can_delete?: boolean | null;
};

export function toVehicleComment(row: CommentRow): VehicleComment {
  return {
    id: row.id,
    userId: row.user_id,
    content: row.content,
    createdAt: row.created_at,
    username: row.username ?? null,
    displayName: row.display_name ?? null,
    avatarUrl: row.avatar_url ?? null,
    isSeller: Boolean(row.is_seller),
    isMine: Boolean(row.is_mine),
    canDelete: Boolean(row.can_delete),
  };
}

/** Görünen ad: @kullanıcı_adı (yorum yazmak için şart), yoksa ad */
export function commentAuthorName(comment: Pick<VehicleComment, "username" | "displayName">): string {
  return comment.username ? `@${comment.username}` : (comment.displayName ?? "Kullanıcı");
}

// ---------------------------------------------------------------
// Metin
// ---------------------------------------------------------------

/** Satır sonları tekleşir, en fazla iki ardışık boş satır, baş/son boşluk kırpılır */
export function cleanComment(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Gönderilemezse kullanıcıya gösterilecek metin (boş, uzun ya da kurala aykırı) */
export function commentError(text: string): string | null {
  const clean = cleanComment(text);
  if (!clean) return "Yorum boş olamaz.";
  if (clean.length > COMMENT_MAX_LENGTH) return `Yorum en fazla ${COMMENT_MAX_LENGTH} karakter olabilir.`;
  return commentPolicyError(clean);
}

// ---------------------------------------------------------------
// Zaman: "az önce", "5 dk önce", "3 sa önce", "2 g önce", "3 hf önce", "12 Eyl"
// ---------------------------------------------------------------

const shortDate = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
const shortDateWithYear = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric" });

export function formatCommentTime(iso: string, now: number = Date.now()): string {
  const at = new Date(iso);
  const seconds = Math.floor((now - at.getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 60) return "az önce";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} g önce`;
  if (days < 35) return `${Math.floor(days / 7)} hf önce`;
  return (at.getFullYear() === new Date(now).getFullYear() ? shortDate : shortDateWithYear).format(at);
}

// ---------------------------------------------------------------
// İmleç ve neden kodları
// ---------------------------------------------------------------

/** ?before=<zaman>&beforeId=<uuid>: ikisi de yoksa ilk sayfa, biri bozuksa "invalid" */
export function parseCommentCursor(before: string | null, beforeId: string | null): CommentCursor | null | "invalid" {
  if (!before && !beforeId) return null;
  if (!before || !beforeId || !isUuid(beforeId) || Number.isNaN(Date.parse(before))) return "invalid";
  return { before, beforeId };
}

/** fn_comment_block_reason'ın döndürdüğü nedenler */
export type CommentBlockReason = "auth_required" | "email_unconfirmed" | "listing_unavailable" | "username_required" | "blocked";

export const COMMENT_BLOCK_RESPONSES: Record<CommentBlockReason, { status: number; message: string }> = {
  auth_required: { status: 401, message: "Yorum yapmak için giriş yapmalısın." },
  email_unconfirmed: { status: 403, message: "Yorum yapmak için e-posta adresini onaylamalısın." },
  listing_unavailable: { status: 404, message: "Bu ilan yayında değil; yorum yapılamaz." },
  username_required: { status: 409, message: "Yorum yapmak için önce bir kullanıcı adı seç." },
  blocked: { status: 403, message: "Bu ilana yorum yapamazsın." },
};

export function isCommentBlockReason(value: unknown): value is CommentBlockReason {
  return typeof value === "string" && Object.hasOwn(COMMENT_BLOCK_RESPONSES, value);
}

// ---------------------------------------------------------------
// İyimser liste işlemleri (yorum penceresi)
// ---------------------------------------------------------------

/** Pencerede gösterilen yorum: gönderilirken ya da gönderilemediyse yerel kimlikle */
export type DisplayComment = VehicleComment & { pending?: "sending" | "failed" };

/** Yeni yorumu en üste ekler; sunucudan aynı kimlik zaten geldiyse eklemez */
export function prependComment(list: readonly DisplayComment[], comment: DisplayComment): DisplayComment[] {
  return [comment, ...list.filter((item) => item.id !== comment.id)];
}

/** Yerel yorumu sunucunun yazdığıyla değiştirir */
export function replaceComment(list: readonly DisplayComment[], id: string, next: DisplayComment): DisplayComment[] {
  return list.map((item) => (item.id === id ? next : item));
}

/** Yeni sayfayı sona ekler (aynı kimlik iki kez görünmez) */
export function appendComments(list: readonly DisplayComment[], page: readonly VehicleComment[]): DisplayComment[] {
  const seen = new Set(list.map((item) => item.id));
  return [...list, ...page.filter((item) => !seen.has(item.id))];
}

// ---------------------------------------------------------------
// Tarayıcıdan API çağrıları
// ---------------------------------------------------------------

export type CommentsFailure = { ok: false; status: number; code: string; message: string };

const NETWORK_ERROR = "Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.";
const GENERIC_ERROR = "İşlem tamamlanamadı. Biraz sonra tekrar dene.";

async function callCommentsApi<T>(
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: object; accessToken?: string | null },
  fetchImpl: typeof fetch,
): Promise<{ ok: true; body: T } | CommentsFailure> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: init.method,
      cache: "no-store",
      headers: {
        ...(init.accessToken ? { Authorization: `Bearer ${init.accessToken}` } : {}),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, code: "network_error", message: NETWORK_ERROR };
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
  if (response.ok && body) return { ok: true, body };
  return {
    ok: false,
    status: response.status,
    code: body?.error?.code ?? "error",
    message: body?.error?.message ?? GENERIC_ERROR,
  };
}

const commentsPath = (vehicleId: string) => `/api/vehicles/${encodeURIComponent(vehicleId)}/comments`;

export async function fetchComments(
  vehicleId: string,
  { cursor = null, accessToken = null, limit = COMMENTS_PAGE_SIZE }: { cursor?: CommentCursor | null; accessToken?: string | null; limit?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; page: CommentsPage } | CommentsFailure> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) {
    params.set("before", cursor.before);
    params.set("beforeId", cursor.beforeId);
  }
  const result = await callCommentsApi<CommentsPage>(`${commentsPath(vehicleId)}?${params}`, { method: "GET", accessToken }, fetchImpl);
  return result.ok ? { ok: true, page: result.body } : result;
}

export async function postComment(
  vehicleId: string,
  content: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; comment: VehicleComment } | CommentsFailure> {
  const result = await callCommentsApi<{ comment: VehicleComment }>(
    commentsPath(vehicleId),
    { method: "POST", body: { content }, accessToken },
    fetchImpl,
  );
  return result.ok ? { ok: true, comment: result.body.comment } : result;
}

export async function deleteComment(
  vehicleId: string,
  commentId: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | CommentsFailure> {
  const result = await callCommentsApi<{ ok: true }>(
    `${commentsPath(vehicleId)}/${encodeURIComponent(commentId)}`,
    { method: "DELETE", accessToken },
    fetchImpl,
  );
  return result.ok ? { ok: true } : result;
}
