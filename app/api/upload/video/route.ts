import { NextResponse } from "next/server";
import {
  MAX_VIDEO_FILE_BYTES,
  UPLOAD_URL_TTL_MINUTES,
  deleteStreamVideo,
  getDirectUploadUrl,
  type DirectUpload,
} from "../../../../lib/cloudflare";
import { isUuid } from "../../../../lib/feed";
import { getAuthenticatedUserId, getSupabaseAdmin } from "../../../../lib/supabase-server";

// POST /api/upload/video
//
// İstek (tarayıcıdan):
//   headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }
//   body:    { vehicleId, fileSize: file.size, fileName?: file.name, fileType?: file.type }
//
// Yanıt (201):
//   { videoId, streamUid, uploadUrl, expiresAt, maxDurationSeconds, maxFileBytes }
//
// Tarayıcı dosyayı tus-js-client ile doğrudan Cloudflare'e yükler:
//   new tus.Upload(file, { uploadUrl, uploadSize: file.size, chunkSize: 50 * 1024 * 1024 }).start()
// Video işlenince Cloudflare, /api/webhooks/cloudflare rotasını çağırır.

type UploadRequestBody = {
  vehicleId?: unknown;
  fileSize?: unknown;
  fileName?: unknown;
  fileType?: unknown;
};

// Bir kullanıcının aynı anda bekleyen (henüz işlenmemiş) yükleme sayısı.
// Her bağlantı Cloudflare kotasından MAX_VIDEO_DURATION_SECONDS kadar dakika ayırır;
// sınır olmazsa tek bir hesap tüm kotayı kilitleyebilir.
const MAX_PENDING_UPLOADS_PER_USER = 5;

// Satılmış, arşivlenmiş ya da moderasyonla kaldırılmış ilana video eklenmez
const LOCKED_VEHICLE_STATUSES = new Set(["sold", "archived", "rejected"]);

// details: hata ayıklama için Cloudflare'in ham mesajı (varsa). message zaten
// kullanıcıya gösterilebilir bir metin; details onu Cloudflare'in orijinal
// yanıtıyla değiştirir/zenginleştirir (bkz. lib/cloudflare.ts readErrorMessage).
function errorResponse(status: number, code: string, message: string, details?: string) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function POST(request: Request) {
  const supabase = getSupabaseAdmin();

  // 1) Kimlik doğrulama
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return errorResponse(401, "unauthorized", "Video yüklemek için giriş yapmalısın.");
  }

  // 2) İstek gövdesi
  let body: UploadRequestBody;
  try {
    body = (await request.json()) as UploadRequestBody;
  } catch {
    return errorResponse(400, "invalid_json", "İstek gövdesi geçerli bir JSON değil.");
  }

  const { vehicleId, fileSize, fileName, fileType } = body;

  if (!isUuid(vehicleId)) {
    return errorResponse(400, "invalid_vehicle_id", "Geçerli bir ilan seçilmedi.");
  }
  if (typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize <= 0) {
    return errorResponse(400, "invalid_file_size", "Dosya boyutu okunamadı.");
  }
  if (fileSize > MAX_VIDEO_FILE_BYTES) {
    return errorResponse(
      413,
      "file_too_large",
      `Video en fazla ${Math.round(MAX_VIDEO_FILE_BYTES / (1024 * 1024))} MB olabilir. Daha kısa ya da daha düşük çözünürlükte bir video dene.`,
    );
  }
  if (fileType !== undefined && (typeof fileType !== "string" || !fileType.startsWith("video/"))) {
    return errorResponse(415, "unsupported_file_type", "Sadece video dosyası yükleyebilirsin.");
  }

  // 3) İlan sahipliği ve durumu
  const { data: vehicle, error: vehicleError } = await supabase
    .from("vehicles")
    .select("id, seller_id, status")
    .eq("id", vehicleId)
    .maybeSingle();

  if (vehicleError) {
    console.error("İlan okunamadı:", vehicleError);
    return errorResponse(500, "database_error", "İlan bilgisi okunamadı. Biraz sonra tekrar dene.");
  }
  if (!vehicle) {
    return errorResponse(404, "vehicle_not_found", "İlan bulunamadı.");
  }
  if (vehicle.seller_id !== userId) {
    return errorResponse(403, "forbidden", "Bu ilana video yükleme yetkin yok.");
  }
  if (LOCKED_VEHICLE_STATUSES.has(vehicle.status)) {
    return errorResponse(
      409,
      "vehicle_locked",
      "Satılmış, arşivlenmiş ya da yayından kaldırılmış bir ilana video eklenemez.",
    );
  }

  // 4) Kötüye kullanım sınırı: son bağlantı süresi içinde açılmış, bekleyen yüklemeler
  const since = new Date(Date.now() - UPLOAD_URL_TTL_MINUTES * 60_000).toISOString();
  const { count: pendingCount, error: countError } = await supabase
    .from("videos")
    .select("id, vehicles!inner(seller_id)", { count: "exact", head: true })
    .eq("vehicles.seller_id", userId)
    .eq("status", "pending")
    .gte("created_at", since);

  if (countError) {
    console.error("Bekleyen yüklemeler sayılamadı:", countError);
    return errorResponse(500, "database_error", "Yükleme başlatılamadı. Biraz sonra tekrar dene.");
  }
  if ((pendingCount ?? 0) >= MAX_PENDING_UPLOADS_PER_USER) {
    return errorResponse(
      429,
      "too_many_pending_uploads",
      "Tamamlanmamış çok fazla yüklemen var. Birkaç dakika sonra tekrar dene.",
    );
  }

  // 5) Cloudflare'de tek kullanımlık yükleme bağlantısı
  let upload: DirectUpload;
  try {
    upload = await getDirectUploadUrl({
      fileSize,
      creatorId: userId,
      vehicleId,
      fileName: typeof fileName === "string" ? fileName : undefined,
    });
  } catch (error) {
    console.error("Cloudflare yükleme bağlantısı oluşturulamadı:", error);
    // CloudflareStreamError.message "Cloudflare <status>: <mesaj> (<kod>)" biçiminde
    // (bkz. lib/cloudflare.ts readErrorMessage). Ortam değişkeni eksikse getStreamConfig
    // düz bir Error fırlatır; o mesaj da (sır içermediği için) details'e yansıtılır.
    const details = error instanceof Error ? error.message : undefined;
    return errorResponse(
      502,
      "upload_provider_error",
      "Video yükleme bağlantısı oluşturulamadı. Biraz sonra tekrar dene.",
      details,
    );
  }

  // 6) videos kaydı: webhook bu satırı stream_uid ile bulup 'ready' yapacak
  const { data: video, error: insertError } = await supabase
    .from("videos")
    .insert({ vehicle_id: vehicleId, stream_uid: upload.streamUid, status: "pending" })
    .select("id")
    .single();

  if (insertError || !video) {
    console.error("videos kaydı açılamadı:", insertError);
    // Kaydı olmayan video Cloudflare'de sahipsiz kalmasın
    await deleteStreamVideo(upload.streamUid).catch((error) =>
      console.error("Sahipsiz Cloudflare videosu silinemedi:", upload.streamUid, error),
    );
    return errorResponse(500, "database_error", "Yükleme başlatılamadı. Biraz sonra tekrar dene.");
  }

  return NextResponse.json(
    {
      videoId: video.id,
      streamUid: upload.streamUid,
      uploadUrl: upload.uploadUrl,
      expiresAt: upload.expiresAt,
      maxDurationSeconds: upload.maxDurationSeconds,
      maxFileBytes: MAX_VIDEO_FILE_BYTES,
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}