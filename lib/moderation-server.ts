import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseAdminEmails,
  toCommentReportQueue,
  toModerationQueue,
  toPendingListing,
  type CommentAuthorRow,
  type CommentReportItem,
  type ModerationItem,
  type OpenCommentReportRow,
  type OpenReportRow,
  type PendingListing,
  type PendingListingRow,
} from "./moderation";
import { getAuthenticatedUser, getAuthenticatedUserId, getSupabaseAdmin } from "./supabase-server";

// Moderasyon paneli: yönetici denetimi ve servis anahtarıyla yapılan işlemler.
// Sadece app/api/admin/* route'larında kullanılır.

export type AdminAuthResult = { ok: true; userId: string } | { ok: false; status: 401 | 403 };

/**
 * İsteği yapan, ADMIN_EMAILS'teki doğrulanmış bir e-postaya sahip mi?
 *
 * Yetki e-postadan gelir; users.role'e bakılmaz (users_update_own politikası
 * kullanıcının kendi satırını, dolayısıyla rolünü de değiştirmesine izin verir).
 * E-posta JWT'den değil, Auth'taki güncel kayıttan okunur ve onaylı olmalıdır:
 * e-posta onayı kapalıysa biri yönetici adresiyle kayıt olabilirdi.
 */
export async function authorizeAdmin(
  request: Request,
  adminEmails: Set<string> = parseAdminEmails(process.env.ADMIN_EMAILS),
): Promise<AdminAuthResult> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return { ok: false, status: 401 };
  if (adminEmails.size === 0) return { ok: false, status: 403 };
  return (await isConfirmedAdmin(userId, adminEmails)) ? { ok: true, userId } : { ok: false, status: 403 };
}

/** Auth'taki güncel kayıt: e-posta listede, onaylı ve hesap yasaklı değil */
async function isConfirmedAdmin(userId: string, adminEmails: Set<string>): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(userId);
  const user = data?.user;
  const email = user?.email?.trim().toLowerCase();
  const banned = Boolean(user?.banned_until && new Date(user.banned_until).getTime() > Date.now());
  return Boolean(!error && email && user?.email_confirmed_at && !banned && adminEmails.has(email));
}

export type AdminStatusCheck = { status: 401 } | { status: 200; admin: false } | { status: 200; admin: true; userId: string };

/**
 * Yönetim girişini (Vitrinim, Ayarlar) göstermek için: istek yöneticiden mi?
 * Her giriş yapmış kullanıcının sayfası sorduğu için ucuz olmalı: token'daki
 * e-posta listede değilse Auth'a hiç gidilmez. Listedeyse authorizeAdmin'in
 * tam denetimi (Auth'taki güncel, onaylı e-posta; yasak) yapılır. Token'daki
 * e-posta yalnızca "yönetici değil" demek için kullanılır, yetki vermez.
 */
export async function checkAdminStatus(
  request: Request,
  adminEmails: Set<string> = parseAdminEmails(process.env.ADMIN_EMAILS),
): Promise<AdminStatusCheck> {
  const user = await getAuthenticatedUser(request);
  if (!user) return { status: 401 };
  if (!user.email || !adminEmails.has(user.email)) return { status: 200, admin: false };
  return (await isConfirmedAdmin(user.id, adminEmails))
    ? { status: 200, admin: true, userId: user.id }
    : { status: 200, admin: false };
}

/** Tek istekte okunacak en fazla açık bildirim */
export const QUEUE_LIMIT = 500;

export async function fetchModerationQueueRows(
  supabase: SupabaseClient,
): Promise<{ ok: true; items: ModerationItem[] } | { ok: false }> {
  const { data, error } = await supabase
    .from("reports")
    .select(
      `id, reason, details, created_at,
       vehicle:vehicles(id, status, year, price, currency, mileage_km, city, created_at,
         brand:brands(name),
         model:models(name),
         images:vehicle_images(image_url, is_primary, display_order),
         videos(status, hls_url, thumbnail_url))`,
    )
    .eq("status", "open")
    // Yorum şikayetleri ayrı kuyrukta (fetchCommentReportRows)
    .is("comment_id", null)
    .order("created_at", { ascending: true })
    .limit(QUEUE_LIMIT);

  if (error) {
    console.error("Moderasyon: bildirimler okunamadı:", error);
    return { ok: false };
  }
  return { ok: true, items: toModerationQueue((data ?? []) as unknown as OpenReportRow[]) };
}

/**
 * Açık yorum şikayetleri: yorumun metni, ilanı ve şikayetler (servis anahtarı).
 * İlişkiler yabancı anahtar adıyla belirtilir: reports hem ilana hem yoruma bağlı.
 */
export const COMMENT_REPORT_SELECT = `id, reason, details, created_at,
       comment:vehicle_comments!reports_comment_id_fkey(id, content, created_at, user_id),
       vehicle:vehicles!reports_vehicle_id_fkey(id, status, year, price, currency, mileage_km, city, created_at,
         brand:brands(name),
         model:models(name),
         images:vehicle_images(image_url, is_primary, display_order),
         videos(status, hls_url, thumbnail_url))`;

export async function fetchCommentReportRows(
  supabase: SupabaseClient,
): Promise<{ ok: true; items: CommentReportItem[] } | { ok: false }> {
  const { data, error } = await supabase
    .from("reports")
    .select(COMMENT_REPORT_SELECT)
    .eq("status", "open")
    .not("comment_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(QUEUE_LIMIT);

  if (error) {
    console.error("Moderasyon: yorum şikayetleri okunamadı:", error);
    return { ok: false };
  }
  const rows = (data ?? []) as unknown as OpenCommentReportRow[];
  const authors = await fetchCommentAuthors(supabase, rows);
  return { ok: true, items: toCommentReportQueue(rows, authors) };
}

/** Yorum yazarlarının herkese açık yüzü (okunamazsa adlar boş kalır, kuyruk yine gelir) */
async function fetchCommentAuthors(
  supabase: SupabaseClient,
  rows: readonly OpenCommentReportRow[],
): Promise<Map<string, CommentAuthorRow>> {
  const ids = [...new Set(rows.flatMap((row) => (row.comment ? [row.comment.user_id] : [])))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("profiles").select("id, username, display_name, avatar_url").in("id", ids);
  if (error) {
    console.error("Moderasyon: yorum yazarları okunamadı:", error);
    return new Map();
  }
  return new Map(((data ?? []) as CommentAuthorRow[]).map((author) => [author.id, author]));
}

export type ModerationResult =
  | { ok: true; resolved: number }
  | { ok: false; code: "vehicle_not_found" | "database_error" };

/**
 * İlanı yayından kaldırır ('rejected') ve ilanın tüm açık bildirimlerini
 * 'reviewed' yapar. Önce ilan: ikinci adım düşerse ilan yine kaldırılmış olur,
 * işlem tekrarlanabilir (ikisi de aynı sonucu verir). İlandaki yorumların
 * şikayetleri de kapanır: ilan yayından kalkınca yorumları da görünmez.
 */
export async function removeListing(
  supabase: SupabaseClient,
  vehicleId: string,
  moderatorId: string,
  now: Date = new Date(),
): Promise<ModerationResult> {
  const { data: vehicles, error: vehicleError } = await supabase
    .from("vehicles")
    .update({ status: "rejected" })
    .eq("id", vehicleId)
    .select("id");

  if (vehicleError) {
    console.error("Moderasyon: ilan kaldırılamadı:", vehicleError);
    return { ok: false, code: "database_error" };
  }
  if (!vehicles?.length) return { ok: false, code: "vehicle_not_found" };

  return resolveReports(supabase, "reviewed", moderatorId, now, { vehicleId });
}

/** Yalnızca verilen bildirimleri kapatır ('dismissed'); ilana dokunmaz. */
export async function dismissReports(
  supabase: SupabaseClient,
  reportIds: string[],
  moderatorId: string,
  now: Date = new Date(),
): Promise<ModerationResult> {
  return resolveReports(supabase, "dismissed", moderatorId, now, { reportIds });
}

/** Açık bildirimleri kapatır: bir ilanın hepsini ya da verilen id'leri */
async function resolveReports(
  supabase: SupabaseClient,
  status: "reviewed" | "dismissed",
  moderatorId: string,
  now: Date,
  scope: { vehicleId: string } | { reportIds: string[] },
): Promise<ModerationResult> {
  let query = supabase
    .from("reports")
    .update({ status, resolved_at: now.toISOString(), resolved_by: moderatorId })
    .eq("status", "open");
  query = "vehicleId" in scope ? query.eq("vehicle_id", scope.vehicleId) : query.in("id", scope.reportIds);
  const { data, error } = await query.select("id");

  if (error) {
    console.error("Moderasyon: bildirimler kapatılamadı:", error);
    return { ok: false, code: "database_error" };
  }
  return { ok: true, resolved: data?.length ?? 0 };
}

// ---------------------------------------------------------------
// İçerik denetimi kuyruğu
// ---------------------------------------------------------------

export const PENDING_LISTING_SELECT = `id, seller_id, status, moderation_status, moderation_reason, description, year, price, currency,
       mileage_km, city, created_at, views_count,
       brand:brands(name),
       model:models(name),
       images:vehicle_images(image_url, is_primary, display_order),
       videos(status, hls_url, thumbnail_url, duration_seconds)`;

/** Tek istekte okunacak en fazla ilan */
export const PENDING_LISTINGS_LIMIT = 200;

/**
 * Yönetici kararını bekleyen ilanlar, en eskisi önce: otomatik denetimi süren
 * ya da şüpheli ('pending_moderation'), otomatik denetimi temiz bulan
 * ('pending_approval') ve bunlardan satıcının arada arşive aldıkları
 * (moderation_reason dolu). Hiçbir ilan yönetici onayı olmadan yayına girmez.
 * Videosu henüz işlenmemiş ilanlar ('pending_video') burada görünmez.
 */
/** Kuyruk süzgeci: karar bekleyen durumlar ya da arada arşive alınmış (nedeni yazılmış) ilan */
export const PENDING_QUEUE_FILTER = "status.in.(pending_moderation,pending_approval),moderation_reason.not.is.null";

export async function fetchPendingListingRows(
  supabase: SupabaseClient,
): Promise<{ ok: true; items: PendingListing[] } | { ok: false }> {
  const { data, error } = await supabase
    .from("vehicles")
    .select(PENDING_LISTING_SELECT)
    .eq("moderation_status", "pending")
    .or(PENDING_QUEUE_FILTER)
    .order("created_at", { ascending: true })
    .limit(PENDING_LISTINGS_LIMIT);

  if (error) {
    console.error("Moderasyon: denetim kuyruğu okunamadı:", error);
    return { ok: false };
  }
  const rows = (data ?? []) as unknown as PendingListingRow[];
  const usernames = await fetchSellerUsernames(supabase, rows);
  return {
    ok: true,
    items: rows.map((row) => toPendingListing(row, { sellerUsername: usernames.get(row.seller_id ?? "") ?? null })),
  };
}

/** Satıcıların kullanıcı adları (servis anahtarı; okunamazsa adlar boş kalır, kuyruk yine gelir) */
async function fetchSellerUsernames(supabase: SupabaseClient, rows: PendingListingRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.flatMap((row) => (row.seller_id ? [row.seller_id] : [])))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("profiles").select("id, username").in("id", ids);
  if (error) {
    console.error("Moderasyon: satıcı adları okunamadı:", error);
    return new Map();
  }
  return new Map(
    ((data ?? []) as { id: string; username: string | null }[]).flatMap((p) => (p.username ? [[p.id, p.username]] : [])),
  );
}

/**
 * Yönetim girişindeki rozet: karar bekleyen ilan ve açık bildirim sayısı
 * (yalnızca sayım; satır okunmaz). Okunamayan sayı null.
 */
export async function fetchAdminCounts(
  supabase: SupabaseClient,
): Promise<{ pendingListings: number | null; openReports: number | null }> {
  const [listings, reports] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id", { count: "exact", head: true })
      .eq("moderation_status", "pending")
      .or(PENDING_QUEUE_FILTER),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);
  if (listings.error) console.error("Moderasyon: bekleyen ilanlar sayılamadı:", listings.error);
  if (reports.error) console.error("Moderasyon: açık bildirimler sayılamadı:", reports.error);
  return {
    pendingListings: listings.error ? null : (listings.count ?? 0),
    openReports: reports.error ? null : (reports.count ?? 0),
  };
}
