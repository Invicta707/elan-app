import { NextResponse } from "next/server";
import { parseTestListingAction } from "../../../../lib/moderation";
import { authorizeAdmin } from "../../../../lib/moderation-server";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";
import { fetchTestListingRows, removeTestListings } from "../../../../lib/test-listings-server";

// Test (deneme) ilanları (moderasyon paneli, /admin/reports → "Test ilanları").
//
// İki uç da Authorization: Bearer <access_token> ister ve yalnızca ADMIN_EMAILS'te
// listelenen, onaylı e-postalı kullanıcılara açıktır (bkz. lib/moderation-server.ts).
// 401: oturum yok ya da geçersiz, 403: yönetici değil.
//
// GET  → 200 { items: TestListing[] }: vehicles.is_test = true olan ilanlar, en yenisi önce.
// POST → body { action: "delete_all" } → 200 { deleted, failures }: bütün test ilanları
//        videoları (Cloudflare), fotoğrafları (Storage) ve bağlı kayıtlarıyla silinir.

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

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if ("response" in admin) return admin.response;

  const result = await fetchTestListingRows(getSupabaseAdmin());
  if (!result.ok) return errorResponse(500, "database_error", "Test ilanları yüklenemedi. Biraz sonra tekrar dene.");
  return NextResponse.json({ items: result.items }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if ("response" in admin) return admin.response;

  const parsed = parseTestListingAction(await request.json().catch(() => null));
  if (!parsed.ok) return errorResponse(400, parsed.code, parsed.message);

  const result = await removeTestListings(getSupabaseAdmin());
  if (!result.ok) return errorResponse(500, "database_error", "Test ilanları silinemedi. Biraz sonra tekrar dene.");

  console.info(`Test ilanları silindi: ${result.deleted} ilan, yönetici ${admin.userId}`);
  return NextResponse.json({ deleted: result.deleted, failures: result.failures }, { headers: NO_STORE });
}
