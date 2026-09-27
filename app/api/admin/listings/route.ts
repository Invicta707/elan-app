import { NextResponse } from "next/server";
import { streamVideoAvailable } from "../../../../lib/cloudflare";
import { createListingModerationStore, decideListingManually, moderateListing } from "../../../../lib/listing-moderation";
import { parseListingDecision } from "../../../../lib/moderation";
import { authorizeAdmin, fetchPendingListingRows } from "../../../../lib/moderation-server";
import { moderationProvidersFromEnv } from "../../../../lib/moderation-providers";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";

// İçerik denetimi kuyruğu API'si (/admin/reports sayfasının "İçerik denetimi" bölümü).
//
// Yetki /api/admin/reports ile aynı: Authorization: Bearer <access_token>,
// yalnızca ADMIN_EMAILS'teki onaylı e-postalar (bkz. lib/moderation-server.ts).
// 401: oturum yok ya da geçersiz, 403: yönetici değil.
//
// GET  → 200 { items: PendingListing[] }: kararı insana kalan ilanlar, en eskisi önce
// POST → body { action: "approve" | "reject" | "recheck", vehicleId }
//        approve: denetim 'approved', ilan yayına girer
//        reject:  ilan ve denetim 'rejected'; video ve fotoğraflar silinir
//        recheck: otomatik denetim yeniden çalışır (ör. sağlayıcı anahtarı sonradan eklendi)
//        → 200 { ok: true, decision, published } | 404 | 409 already_decided (karar zaten
//          verilmiş) | 409 video_missing (onay: video Cloudflare'de silinmiş, ilan yayına alınamaz)

/** recheck: video kareleri ve fotoğraflar denetlenirken */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

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

const NOT_FOUND = () => errorResponse(404, "vehicle_not_found", "İlan bulunamadı; silinmiş olabilir.");
const ALREADY_DECIDED = () =>
  errorResponse(409, "already_decided", "Bu ilan için karar zaten verilmiş. Listeyi yenile.");
const VIDEO_MISSING = () =>
  errorResponse(
    409,
    "video_missing",
    "Bu ilanın videosu Cloudflare'de bulunamadı (silinmiş). Yayına alınamaz; ilanı reddedebilirsin.",
  );

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if ("response" in admin) return admin.response;

  const queue = await fetchPendingListingRows(getSupabaseAdmin());
  if (!queue.ok) return errorResponse(500, "database_error", "Denetim kuyruğu yüklenemedi. Biraz sonra tekrar dene.");
  return NextResponse.json({ items: queue.items }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if ("response" in admin) return admin.response;

  const parsed = parseListingDecision(await request.json().catch(() => null));
  if (!parsed.ok) return errorResponse(400, parsed.code, parsed.message);
  const { action, vehicleId } = parsed.value;
  const store = createListingModerationStore(getSupabaseAdmin());

  try {
    if (action === "recheck") {
      const result = await moderateListing(vehicleId, { store, providers: moderationProvidersFromEnv() });
      if (result.status === "skipped") return result.reason === "not_found" ? NOT_FOUND() : ALREADY_DECIDED();
      return NextResponse.json(
        { ok: true, decision: result.decision, published: result.published },
        { headers: NO_STORE },
      );
    }

    const result = await decideListingManually(store, vehicleId, action, admin.userId, {
      videoAvailable: streamVideoAvailable,
    });
    if (!result.ok) {
      if (result.code === "vehicle_not_found") return NOT_FOUND();
      return result.code === "video_missing" ? VIDEO_MISSING() : ALREADY_DECIDED();
    }
    return NextResponse.json(
      { ok: true, decision: action === "approve" ? "safe" : "rejected", published: result.published },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("Moderasyon: ilan kararı uygulanamadı:", vehicleId, error);
    // Örn. yayın şartı: işlenmiş video yoksa onaylanan ilan yayına alınamaz
    const message =
      error && typeof error === "object" && (error as { code?: string }).code === "23514"
        ? ((error as { message?: string }).message ?? "İlan yayına alınamadı.")
        : "İşlem kaydedilemedi. Biraz sonra tekrar dene.";
    return errorResponse(500, "database_error", message);
  }
}
