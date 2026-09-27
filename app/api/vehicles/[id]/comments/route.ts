import { NextResponse } from "next/server";
import { COMMENTS_PAGE_SIZE, parseCommentCursor } from "../../../../../lib/comments";
import { createVehicleComment, listVehicleComments } from "../../../../../lib/comments-server";
import { isUuid } from "../../../../../lib/feed";
import { checkAdminStatus } from "../../../../../lib/moderation-server";
import { moderationProvidersFromEnv } from "../../../../../lib/moderation-providers";
import { createRateLimiter } from "../../../../../lib/rate-limit";
import {
  bearerToken,
  getAuthenticatedUserId,
  getSupabaseAdmin,
  getSupabaseForUser,
  getSupabasePublic,
} from "../../../../../lib/supabase-server";

// GET  /api/vehicles/[id]/comments?limit=20&before=<zaman>&beforeId=<uuid>
//      Authorization isteğe bağlı (varsa "Sil" hakları ona göre).
//      → 200 { total, comments: VehicleComment[], nextCursor } | 404 ilan yayında değil
// POST /api/vehicles/[id]/comments   body { content }   Authorization zorunlu
//      → 201 { comment } | 400 | 401 | 403 | 404 | 409 username_required | 422 content_policy | 429
//
// Okuma ve yazma, isteği yapanın kendi yetkisiyle (RLS): yayındaki ilan, onaylı
// e-posta, kullanıcı adı, engel, metin filtresi ve spam sınırı (aynı ilana
// 10 saniyede bir, dakikada 10) veritabanında. Kurallar: *_vehicle_comments.sql

type Context = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

/** Sunucu örneği başına kullanıcıdan dakikada 30 yazma isteği (kalıcı sınır veritabanında) */
const burst = createRateLimiter({ limit: 30, windowMs: 60_000 });

function errorResponse(status: number, code: string, message: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { ...NO_STORE, ...headers } });
}

const LISTING_NOT_FOUND = () => errorResponse(404, "vehicle_not_found", "İlan bulunamadı ya da yayında değil.");

export async function GET(request: Request, { params }: Context) {
  const { id: vehicleId } = await params;
  if (!isUuid(vehicleId)) return LISTING_NOT_FOUND();

  const url = new URL(request.url);
  const cursor = parseCommentCursor(url.searchParams.get("before"), url.searchParams.get("beforeId"));
  if (cursor === "invalid") return errorResponse(400, "invalid_cursor", "Sayfa bilgisi geçersiz.");
  const limit = Number(url.searchParams.get("limit") ?? COMMENTS_PAGE_SIZE);

  // Oturum varsa onun yetkisiyle (kendi yorumu, satıcının ilanı); geçersizse misafir
  const token = bearerToken(request);
  const userId = token ? await getAuthenticatedUserId(request) : null;
  const client = token && userId ? getSupabaseForUser(token) : getSupabasePublic();
  // Yönetici her yorumu silebilir (yönetici olmayan için yalnızca token denetlenir)
  const viewerIsAdmin = userId ? await isAdmin(request) : false;

  const result = await listVehicleComments(client, vehicleId, { cursor, limit, viewerIsAdmin });
  if (!result.ok) return errorResponse(result.status, result.code, result.message);
  return NextResponse.json(result.page, { headers: NO_STORE });
}

async function isAdmin(request: Request): Promise<boolean> {
  const check = await checkAdminStatus(request);
  return check.status === 200 && check.admin;
}

export async function POST(request: Request, { params }: Context) {
  const { id: vehicleId } = await params;
  const token = bearerToken(request);
  const userId = token ? await getAuthenticatedUserId(request) : null;
  if (!token || !userId) return errorResponse(401, "auth_required", "Yorum yapmak için giriş yapmalısın.");
  if (!isUuid(vehicleId)) return LISTING_NOT_FOUND();

  const limited = burst(userId);
  if (!limited.ok) {
    return errorResponse(429, "rate_limited", "Çok hızlı yorum yazıyorsun; biraz bekleyip tekrar dene.", {
      "Retry-After": String(limited.retryAfterSeconds),
    });
  }

  const body = (await request.json().catch(() => null)) as { content?: unknown } | null;
  const result = await createVehicleComment({
    userClient: getSupabaseForUser(token),
    adminClient: getSupabaseAdmin(),
    textModerator: moderationProvidersFromEnv().text,
    userId,
    vehicleId,
    content: body?.content,
  });
  if (!result.ok) {
    return errorResponse(result.status, result.code, result.message, result.status === 429 ? { "Retry-After": "10" } : undefined);
  }
  return NextResponse.json({ comment: result.comment }, { status: 201, headers: NO_STORE });
}
