import { NextResponse } from "next/server";
import { parseModerationAction } from "../../../../lib/moderation";
import {
  authorizeAdmin,
  dismissReports,
  fetchModerationQueueRows,
  removeListing,
} from "../../../../lib/moderation-server";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";

// Moderasyon paneli API'si (/admin/reports sayfası kullanır).
//
// İki uç da Authorization: Bearer <access_token> ister ve yalnızca ADMIN_EMAILS'te
// listelenen, onaylı e-postalı kullanıcılara açıktır (bkz. lib/moderation-server.ts).
// 401: oturum yok ya da geçersiz, 403: yönetici değil.
//
// GET  → 200 { items: ModerationItem[] }: açık bildirimler, ilan başına gruplu,
//        en eski bildirimi olan ilan önce.
// POST → body { action: "remove_listing", vehicleId } | { action: "dismiss", reportIds }
//        → 200 { ok: true, resolved: <kapatılan bildirim sayısı> }

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

/** Yönetici değilse döndürülecek yanıt; yöneticiyse kullanıcı id'si */
async function requireAdmin(request: Request): Promise<{ userId: string } | { response: NextResponse }> {
  const auth = await authorizeAdmin(request);
  if (auth.ok) return { userId: auth.userId };
  return {
    response:
      auth.status === 401
        ? errorResponse(401, "unauthorized", "Bu sayfa için giriş yapmalısın.")
        : errorResponse(403, "forbidden", "Bu sayfaya erişim yetkin yok."),
  };
}

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if ("response" in admin) return admin.response;

  const queue = await fetchModerationQueueRows(getSupabaseAdmin());
  if (!queue.ok) return errorResponse(500, "database_error", "Bildirimler yüklenemedi. Biraz sonra tekrar dene.");

  return NextResponse.json({ items: queue.items }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if ("response" in admin) return admin.response;

  const body = await request.json().catch(() => null);
  const parsed = parseModerationAction(body);
  if (!parsed.ok) return errorResponse(400, parsed.code, parsed.message);

  const input = parsed.value;
  const supabase = getSupabaseAdmin();
  const result =
    input.action === "remove_listing"
      ? await removeListing(supabase, input.vehicleId, admin.userId)
      : await dismissReports(supabase, input.reportIds, admin.userId);

  if (!result.ok) {
    return result.code === "vehicle_not_found"
      ? errorResponse(404, "vehicle_not_found", "İlan bulunamadı; silinmiş olabilir.")
      : errorResponse(500, "database_error", "İşlem kaydedilemedi. Biraz sonra tekrar dene.");
  }

  return NextResponse.json({ ok: true, resolved: result.resolved }, { headers: NO_STORE });
}
