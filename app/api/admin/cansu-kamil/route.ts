import { NextResponse } from "next/server";
import { parseKillSwitchBody, setCansuPageDisabled } from "../../../../lib/cansu-kamil-switch";
import { authorizeAdmin } from "../../../../lib/moderation-server";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";

// /cansu-kamil kapatma düğmesi (kill-switch).
//
// POST, Authorization: Bearer <access_token>; yalnızca ADMIN_EMAILS'te listelenen,
// onaylı e-postalı kullanıcılara açık (bkz. lib/moderation-server.ts).
// body { disabled: true }  → sayfa herkes için 404
// body { disabled: false } → sayfa yeniden açılır
// 401: oturum yok ya da geçersiz, 403: yönetici değil, 400: gövde bozuk.

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  const auth = await authorizeAdmin(request);
  if (!auth.ok) {
    return auth.status === 401
      ? errorResponse(401, "unauthorized", "Önce yönetici hesabıyla giriş yapmalısın.")
      : errorResponse(403, "forbidden", "Bu işlem için yetkin yok.");
  }

  const parsed = parseKillSwitchBody(await request.json().catch(() => null));
  if (!parsed.ok) return errorResponse(400, "invalid_body", "Gövde { disabled: boolean } olmalı.");

  const result = await setCansuPageDisabled(getSupabaseAdmin(), parsed.disabled, auth.userId);
  if (!result.ok) return errorResponse(500, "database_error", "Ayar kaydedilemedi. Biraz sonra tekrar dene.");

  console.info(`/cansu-kamil ${parsed.disabled ? "kapatıldı" : "açıldı"}, yönetici ${auth.userId}`);
  return NextResponse.json({ disabled: parsed.disabled }, { headers: NO_STORE });
}
