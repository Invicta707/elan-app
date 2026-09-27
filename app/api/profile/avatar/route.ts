import { NextResponse } from "next/server";
import { MAX_AVATAR_BYTES, detectAvatarType } from "../../../../lib/avatar";
import { deleteAvatar, saveAvatar } from "../../../../lib/avatar-server";
import { moderateAvatarUpload, recordModerationEvent } from "../../../../lib/content-moderation-server";
import { moderationProvidersFromEnv } from "../../../../lib/moderation-providers";
import { clientIp, rateLimitSubject } from "../../../../lib/rate-limit";
import { consumeRateLimit, rateLimitSecret } from "../../../../lib/rate-limit-server";
import { getAuthenticatedUserId, getSupabaseAdmin } from "../../../../lib/supabase-server";

// POST   /api/profile/avatar  gövde: sıkıştırılmış görüntü (image/webp | image/jpeg, ≤ 1 MB)
// DELETE /api/profile/avatar  profil fotoğrafını kaldırır
// İkisi de Authorization: Bearer <access_token> ister. Yanıt: { avatarUrl } | { error }
//
// Yüklenen fotoğraf kaydedilmeden önce otomatik içerik denetiminden geçer
// (lib/content-moderation-server.ts moderateAvatarUpload): kurala aykırı ya da
// şüpheli fotoğraf 422, denetlenemezse 503; ikisinde de hiçbir şey kaydedilmez.

const RULES = [{ scope: "user", limit: 20, windowSeconds: 60 * 60 }] as const;

function errorResponse(status: number, message: string) {
  return NextResponse.json({ error: { message } }, { status });
}

async function authorize(request: Request) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return { response: errorResponse(401, "Bu işlem için giriş yapmalısın.") };

  const supabase = getSupabaseAdmin();
  const rate = await consumeRateLimit(
    supabase,
    "avatar",
    RULES,
    { ip: rateLimitSubject(clientIp(request.headers)), userId },
    rateLimitSecret(),
  );
  if (!rate.ok) return { response: errorResponse(429, "Kısa sürede çok fazla deneme yaptın. Biraz bekle.") };
  return { userId, supabase };
}

export async function POST(request: Request) {
  // Gövdeyi okumadan önce: bildirilen boyut sınırın üstündeyse hemen reddet
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_AVATAR_BYTES) return errorResponse(413, "Fotoğraf en fazla 1 MB olabilir.");

  const auth = await authorize(request);
  if ("response" in auth) return auth.response;

  const bytes = new Uint8Array(await request.arrayBuffer());
  // Tür geçersizse denetime gerek yok; saveAvatar 400 döner
  const type = detectAvatarType(bytes);
  if (type && bytes.length <= MAX_AVATAR_BYTES) {
    const moderation = await moderateAvatarUpload(moderationProvidersFromEnv().image, bytes, type);
    await recordModerationEvent(auth.supabase, {
      subjectType: "avatar",
      subjectId: null,
      userId: auth.userId,
      verdict: moderation.verdict,
    });
    if (!moderation.allowed) return errorResponse(moderation.status, moderation.message);
  }

  const result = await saveAvatar(auth.supabase, auth.userId, bytes);
  return result.ok
    ? NextResponse.json({ avatarUrl: result.avatarUrl })
    : errorResponse(result.status, result.message);
}

export async function DELETE(request: Request) {
  const auth = await authorize(request);
  if ("response" in auth) return auth.response;

  const result = await deleteAvatar(auth.supabase, auth.userId);
  return result.ok ? NextResponse.json({ avatarUrl: null }) : errorResponse(result.status, result.message);
}
