import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientIp, createRateLimiter, rateLimitSubject } from "../../../lib/rate-limit";
import { consumeRateLimit, rateLimitSecret } from "../../../lib/rate-limit-server";
import {
  REPORT_BURST_LIMIT,
  REPORT_RATE_RULES,
  isCommentReportBody,
  parseCommentReportInput,
  parseReportInput,
} from "../../../lib/reports";
import { getAuthenticatedUserId, getSupabaseAdmin } from "../../../lib/supabase-server";

// POST /api/reports
//
// İstek (tarayıcıdan):
//   headers: { "Content-Type": "application/json", Authorization?: `Bearer <access_token>` }
//   body:    { vehicleId, reason, details? }            ilan bildirimi
//            { commentId, reason, details? }            yorum şikayeti (ilan yorumdan okunur)
//
// Yanıt: 201 { ok: true } | 200 { ok: true, alreadyReported: true } | 4xx/5xx { error }
//        429 { error } + Retry-After: istek sınırı aşıldı (lib/reports.ts REPORT_RATE_RULES)
//        Yorum şikayetinde ayrıca 404 comment_not_found, 400 own_comment (kendi yorumu)
//
// İstek sınırı iki katmanlı. Önce bellek içi ön sınır gelir: sunucu örneği
// başına çalışır ve ucuzdur. Sonra veritabanındaki kalıcı sayaç: bütün
// örnekler için ortaktır, IP ve kullanıcı özetle saklanır.
// Geçersiz istekler de sayılır.
//
// reports tablosuna tarayıcıdan erişim yok (RLS, politika yok); kayıt burada
// servis anahtarıyla eklenir. Giriş yapmadan da bildirilebilir; oturum varsa
// bildiren kaydedilir ve aynı ilanı ikinci kez bildirmesi tekrar sayılmaz.

const UNIQUE_VIOLATION = "23505";

// Sunucu örneği başına sayılır (bkz. lib/rate-limit.ts)
const checkReportBurst = createRateLimiter(REPORT_BURST_LIMIT);

function errorResponse(status: number, code: string, message: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

function rateLimited(retryAfterSeconds: number) {
  return errorResponse(
    429,
    "rate_limited",
    "Kısa sürede çok fazla bildirim gönderildi. Biraz bekleyip tekrar dene.",
    { "Retry-After": String(retryAfterSeconds) },
  );
}

export async function POST(request: Request) {
  const ip = rateLimitSubject(clientIp(request.headers));

  // 1) Ön sınır: veritabanına ve oturum doğrulamaya gitmeden
  const burst = checkReportBurst(ip);
  if (!burst.ok) return rateLimited(burst.retryAfterSeconds);

  // Geçersiz ya da süresi dolmuş oturum bildirimi engellemez: anonim sayılır
  const reporterId = await getAuthenticatedUserId(request);
  const supabase = getSupabaseAdmin();

  // 2) Kalıcı sınır: oturum varsa kullanıcıya göre de sayılır
  const rate = await consumeRateLimit(
    supabase,
    "reports",
    reporterId ? REPORT_RATE_RULES.authenticated : REPORT_RATE_RULES.anonymous,
    { ip, userId: reporterId },
    rateLimitSecret(),
  );
  if (!rate.ok) return rateLimited(rate.retryAfterSeconds);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "İstek gövdesi geçerli bir JSON değil.");
  }

  if (isCommentReportBody(body)) return reportComment(supabase, body, reporterId);

  const parsed = parseReportInput(body);
  if (!parsed.ok) return errorResponse(400, parsed.code, parsed.message);
  const { vehicleId, reason, details } = parsed.value;

  const { data: vehicle, error: vehicleError } = await supabase
    .from("vehicles")
    .select("id")
    .eq("id", vehicleId)
    .maybeSingle();

  if (vehicleError) {
    console.error("Bildirim: ilan okunamadı:", vehicleError);
    return errorResponse(500, "database_error", "Bildirim gönderilemedi. Biraz sonra tekrar dene.");
  }
  if (!vehicle) {
    return errorResponse(404, "vehicle_not_found", "Bildirilecek ilan bulunamadı.");
  }

  const { error } = await supabase
    .from("reports")
    .insert({ vehicle_id: vehicleId, reporter_id: reporterId, reason, details });

  if (error?.code === UNIQUE_VIOLATION) {
    return NextResponse.json({ ok: true, alreadyReported: true });
  }
  if (error) {
    console.error("Bildirim kaydedilemedi:", error);
    return errorResponse(500, "database_error", "Bildirim gönderilemedi. Biraz sonra tekrar dene.");
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

const FOREIGN_KEY_VIOLATION = "23503";

const commentNotFound = () =>
  errorResponse(404, "comment_not_found", "Şikayet edilecek yorum bulunamadı; silinmiş olabilir.");

/**
 * Yorum şikayeti: yorum servis anahtarıyla okunur (ilanı ve yazarı). Kişi kendi
 * yorumunu şikayet edemez; aynı kural veritabanında da var (fn_reports_comment_target).
 */
async function reportComment(supabase: SupabaseClient, body: unknown, reporterId: string | null) {
  const parsed = parseCommentReportInput(body);
  if (!parsed.ok) return errorResponse(400, parsed.code, parsed.message);
  const { commentId, reason, details } = parsed.value;

  const { data, error: commentError } = await supabase
    .from("vehicle_comments")
    .select("id, vehicle_id, user_id")
    .eq("id", commentId)
    .maybeSingle();

  if (commentError) {
    console.error("Yorum şikayeti: yorum okunamadı:", commentError);
    return errorResponse(500, "database_error", "Şikayet gönderilemedi. Biraz sonra tekrar dene.");
  }
  const comment = data as { id: string; vehicle_id: string; user_id: string } | null;
  if (!comment) return commentNotFound();
  if (reporterId && comment.user_id === reporterId) {
    return errorResponse(400, "own_comment", "Kendi yorumunu şikayet edemezsin.");
  }

  const { error } = await supabase
    .from("reports")
    .insert({ vehicle_id: comment.vehicle_id, comment_id: commentId, reporter_id: reporterId, reason, details });

  if (error?.code === UNIQUE_VIOLATION) {
    return NextResponse.json({ ok: true, alreadyReported: true });
  }
  // Yorum bu arada silindi
  if (error?.code === FOREIGN_KEY_VIOLATION) return commentNotFound();
  if (error) {
    console.error("Yorum şikayeti kaydedilemedi:", error);
    return errorResponse(500, "database_error", "Şikayet gönderilemedi. Biraz sonra tekrar dene.");
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
