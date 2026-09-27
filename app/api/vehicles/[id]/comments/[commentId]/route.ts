import { NextResponse } from "next/server";
import { deleteVehicleComment } from "../../../../../../lib/comments-server";
import { isUuid } from "../../../../../../lib/feed";
import { authorizeAdmin } from "../../../../../../lib/moderation-server";
import {
  bearerToken,
  getAuthenticatedUserId,
  getSupabaseAdmin,
  getSupabaseForUser,
} from "../../../../../../lib/supabase-server";

// DELETE /api/vehicles/[id]/comments/[commentId]   Authorization zorunlu
//   Yorumun yazarı ya da ilanın sahibi (kendi oturumuyla, RLS) ya da yönetici
//   (ADMIN_EMAILS, onaylı e-posta; servis anahtarıyla, karar kayda yazılır).
//   → 200 { ok: true } | 401 | 403 | 404

type Context = { params: Promise<{ id: string; commentId: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

export async function DELETE(request: Request, { params }: Context) {
  const { id: vehicleId, commentId } = await params;
  const token = bearerToken(request);
  const userId = token ? await getAuthenticatedUserId(request) : null;
  if (!token || !userId) return errorResponse(401, "auth_required", "Yorum silmek için giriş yapmalısın.");
  if (!isUuid(vehicleId) || !isUuid(commentId)) return errorResponse(404, "comment_not_found", "Yorum bulunamadı.");

  const result = await deleteVehicleComment({
    userClient: getSupabaseForUser(token),
    adminClient: getSupabaseAdmin(),
    userId,
    isAdmin: async () => (await authorizeAdmin(request)).ok,
    vehicleId,
    commentId,
  });
  if (!result.ok) return errorResponse(result.status, result.code, result.message);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
