import { NextResponse } from "next/server";
import { deleteAccount } from "../../../../lib/account-deletion";
import { deleteStreamVideo } from "../../../../lib/cloudflare";
import { getAuthenticatedUserId, getSupabaseAdmin } from "../../../../lib/supabase-server";

// POST /api/user/delete
//
// İstek (tarayıcıdan, /account sayfasındaki onay penceresi):
//   headers: { Authorization: `Bearer <access_token>`, "Content-Type": "application/json" }
//   body:    { confirm: true }
//
// Giriş yapmış kullanıcının hesabını ve tüm verilerini kalıcı olarak siler
// (bkz. lib/account-deletion.ts). Sadece kendi hesabı: kimlik oturum
// anahtarından gelir, istek gövdesinden değil.

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return errorResponse(401, "unauthorized", "Hesabını silmek için giriş yapmalısın.");
  }

  // Yanlışlıkla yapılan çağrılara karşı açık onay
  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== true) {
    return errorResponse(400, "confirmation_required", "Hesap silme onaylanmadı.");
  }

  const result = await deleteAccount(userId, { supabase: getSupabaseAdmin(), deleteStreamVideo });
  if (!result.ok) {
    return errorResponse(500, result.error, "Hesabın silinemedi. Biraz sonra tekrar dene.");
  }
  if (result.cleanupFailures > 0) {
    console.warn(`Hesap silindi (${userId}) ama ${result.cleanupFailures} dosya/video silinemedi.`);
  }

  return NextResponse.json({ ok: true });
}
