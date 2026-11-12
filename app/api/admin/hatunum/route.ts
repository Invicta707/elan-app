import { NextResponse } from "next/server";
import { isHatunumEnabled, parseHatunumBody, setHatunumEnabled } from "../../../../lib/hatunum-switch";
import { authorizeAdmin } from "../../../../lib/moderation-server";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";

// /hatunum aç/kapa anahtarı (/admin/reports → "Hatunum sayfası").
//
// Authorization: Bearer <access_token>; yalnızca ADMIN_EMAILS'teki onaylı
// e-postalı kullanıcılar (lib/moderation-server.ts). Token çerezde değil başlıkta
// gider: başka bir siteden tetiklenen istek (CSRF) onu ekleyemez.
// GET  → { enabled }
// POST { enabled: boolean } → { enabled }
// 401: oturum yok ya da geçersiz, 403: yönetici değil, 400: gövde bozuk.

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

async function requireAdmin(request: Request) {
  const auth = await authorizeAdmin(request);
  if (auth.ok) return auth;
  return auth.status === 401
    ? errorResponse(401, "unauthorized", "Önce yönetici hesabıyla giriş yapmalısın.")
    : errorResponse(403, "forbidden", "Bu işlem için yetkin yok.");
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;
  return NextResponse.json({ enabled: await isHatunumEnabled(getSupabaseAdmin) }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  const parsed = parseHatunumBody(await request.json().catch(() => null));
  if (!parsed.ok) return errorResponse(400, "invalid_body", "Gövde { enabled: boolean } olmalı.");

  const result = await setHatunumEnabled(getSupabaseAdmin(), parsed.enabled, auth.userId);
  if (!result.ok) return errorResponse(500, "database_error", "Ayar kaydedilemedi. Biraz sonra tekrar dene.");

  console.info(`/hatunum ${parsed.enabled ? "açıldı" : "kapatıldı"}, yönetici ${auth.userId}`);
  return NextResponse.json({ enabled: parsed.enabled }, { headers: NO_STORE });
}
