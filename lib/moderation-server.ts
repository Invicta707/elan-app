import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAdminEmails, toModerationQueue, type ModerationItem, type OpenReportRow } from "./moderation";
import { getAuthenticatedUserId, getSupabaseAdmin } from "./supabase-server";

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

  const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(userId);
  const user = data?.user;
  const email = user?.email?.trim().toLowerCase();
  const banned = Boolean(user?.banned_until && new Date(user.banned_until).getTime() > Date.now());

  if (error || !email || !user?.email_confirmed_at || banned || !adminEmails.has(email)) {
    return { ok: false, status: 403 };
  }
  return { ok: true, userId };
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
    .order("created_at", { ascending: true })
    .limit(QUEUE_LIMIT);

  if (error) {
    console.error("Moderasyon: bildirimler okunamadı:", error);
    return { ok: false };
  }
  return { ok: true, items: toModerationQueue((data ?? []) as unknown as OpenReportRow[]) };
}

export type ModerationResult =
  | { ok: true; resolved: number }
  | { ok: false; code: "vehicle_not_found" | "database_error" };

/**
 * İlanı yayından kaldırır ('rejected') ve ilanın tüm açık bildirimlerini
 * 'reviewed' yapar. Önce ilan: ikinci adım düşerse ilan yine kaldırılmış olur,
 * işlem tekrarlanabilir (ikisi de aynı sonucu verir).
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
