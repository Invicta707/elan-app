import { NextResponse } from "next/server";
import { clientIp, createRateLimiter } from "../../../lib/rate-limit";
import { REPORT_RATE_LIMIT, parseReportInput } from "../../../lib/reports";
import { getAuthenticatedUserId, getSupabaseAdmin } from "../../../lib/supabase-server";

// POST /api/reports
//
// İstek (tarayıcıdan):
//   headers: { "Content-Type": "application/json", Authorization?: `Bearer <access_token>` }
//   body:    { vehicleId, reason, details? }
//
// Yanıt: 201 { ok: true } | 200 { ok: true, alreadyReported: true } | 4xx/5xx { error }
//        429 { error } + Retry-After: aynı IP'den dakikada 5'ten fazla istek
//
// reports tablosuna tarayıcıdan erişim yok (RLS, politika yok); kayıt burada
// servis anahtarıyla eklenir. Giriş yapmadan da bildirilebilir; oturum varsa
// bildiren kaydedilir ve aynı ilanı ikinci kez bildirmesi tekrar sayılmaz.

const UNIQUE_VIOLATION = "23505";

// Sunucu örneği başına sayılır (bkz. lib/rate-limit.ts)
const checkReportRate = createRateLimiter(REPORT_RATE_LIMIT);

function errorResponse(status: number, code: string, message: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

export async function POST(request: Request) {
  // Sınır her şeyden önce: geçersiz istekler de sayılır ve veritabanına gitmeden kesilir
  const rate = checkReportRate(clientIp(request.headers));
  if (!rate.ok) {
    return errorResponse(
      429,
      "rate_limited",
      "Bu bağlantıdan kısa sürede çok fazla bildirim gönderildi. Biraz bekleyip tekrar dene.",
      { "Retry-After": String(rate.retryAfterSeconds) },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "İstek gövdesi geçerli bir JSON değil.");
  }

  const parsed = parseReportInput(body);
  if (!parsed.ok) return errorResponse(400, parsed.code, parsed.message);
  const { vehicleId, reason, details } = parsed.value;

  // Geçersiz ya da süresi dolmuş oturum bildirimi engellemez: anonim sayılır
  const reporterId = await getAuthenticatedUserId(request);
  const supabase = getSupabaseAdmin();

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
