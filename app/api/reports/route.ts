import { NextResponse } from "next/server";
import { parseReportInput } from "../../../lib/reports";
import { getAuthenticatedUserId, getSupabaseAdmin } from "../../../lib/supabase-server";

// POST /api/reports
//
// İstek (tarayıcıdan):
//   headers: { "Content-Type": "application/json", Authorization?: `Bearer <access_token>` }
//   body:    { vehicleId, reason, details? }
//
// Yanıt: 201 { ok: true } | 200 { ok: true, alreadyReported: true } | 4xx/5xx { error }
//
// reports tablosuna tarayıcıdan erişim yok (RLS, politika yok); kayıt burada
// servis anahtarıyla eklenir. Giriş yapmadan da bildirilebilir; oturum varsa
// bildiren kaydedilir ve aynı ilanı ikinci kez bildirmesi tekrar sayılmaz.

const UNIQUE_VIOLATION = "23505";

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
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
