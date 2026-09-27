import { NextResponse } from "next/server";
import { getStreamVideoDetails } from "../../../../lib/cloudflare";
import { isUuid } from "../../../../lib/feed";
import { getAuthenticatedUserId, getSupabaseAdmin } from "../../../../lib/supabase-server";
import { runListingModeration } from "../../../../lib/listing-moderation";
import { markVideoReadyAndQueueModeration } from "../../../../lib/video-activation";

// GELİŞTİRME ORTAMINA ÖZEL: Cloudflare Stream webhook'u localhost'a ulaşamadığı
// için video Cloudflare'e yüklendikten sonra videos/vehicles satırlarını burada
// doğrudan güncelliyoruz (Cloudflare'e "hazır mı?" diye sorup webhook'la aynı işlemi,
// markVideoReadyAndQueueModeration + içerik denetimini uyguluyoruz). Denetim burada
// yanıttan önce çalışır: /sell sonucu (yayında / incelemede) gösterebilsin.
// Üretimde bu işi gerçek imzalı webhook üstlenir (bkz.
// app/api/webhooks/cloudflare/route.ts); bu route orada NODE_ENV=production
// olduğu için 404 döner ve hiçbir işlev görmez.
//
// POST /api/dev/complete-upload
//   headers: { Authorization: `Bearer <access_token>` }
//   body:    { videoId }

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 10; // ~20 saniye: Cloudflare'in transcode'u genelde bundan hızlı biter

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return errorResponse(401, "unauthorized", "Giriş yapmalısın.");
  }

  let body: { videoId?: unknown };
  try {
    body = (await request.json()) as { videoId?: unknown };
  } catch {
    return errorResponse(400, "invalid_json", "İstek gövdesi geçerli bir JSON değil.");
  }

  const { videoId } = body;
  if (!isUuid(videoId)) {
    return errorResponse(400, "invalid_video_id", "Geçerli bir video seçilmedi.");
  }

  const supabase = getSupabaseAdmin();

  const { data: video, error: videoError } = await supabase
    .from("videos")
    .select("id, stream_uid, status, vehicle_id")
    .eq("id", videoId)
    .maybeSingle();

  if (videoError) {
    console.error("Dev tamamlama: video okunamadı:", videoError);
    return errorResponse(500, "database_error", "Video bilgisi okunamadı.");
  }
  if (!video) {
    return errorResponse(404, "video_not_found", "Video bulunamadı.");
  }

  // Sahiplik kontrolü: /api/upload/video ile aynı desen (video okuma, sonra ilan sahibi doğrulama)
  const { data: vehicle, error: vehicleError } = await supabase
    .from("vehicles")
    .select("seller_id")
    .eq("id", video.vehicle_id)
    .maybeSingle();

  if (vehicleError) {
    console.error("Dev tamamlama: ilan okunamadı:", vehicleError);
    return errorResponse(500, "database_error", "İlan bilgisi okunamadı.");
  }
  if (!vehicle || vehicle.seller_id !== userId) {
    return errorResponse(403, "forbidden", "Bu video üzerinde yetkin yok.");
  }

  if (video.status === "ready") {
    return NextResponse.json({ ok: true, alreadyReady: true, vehicleId: video.vehicle_id });
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    let details;
    try {
      details = await getStreamVideoDetails(video.stream_uid);
    } catch (error) {
      console.error("Dev tamamlama: Cloudflare video durumu alınamadı:", error);
      return errorResponse(502, "upload_provider_error", "Cloudflare'den video durumu alınamadı.");
    }

    if (details.state === "error") {
      await supabase.from("videos").update({ status: "failed" }).eq("id", videoId);
      return errorResponse(422, "video_processing_failed", "Cloudflare videoyu işleyemedi.");
    }

    if (details.readyToStream && details.hlsUrl) {
      const result = await markVideoReadyAndQueueModeration(supabase, {
        streamUid: video.stream_uid,
        hlsUrl: details.hlsUrl,
        thumbnailUrl: details.thumbnailUrl,
        durationSeconds: details.durationSeconds,
      });

      if (!result.ok) {
        return errorResponse(500, "database_error", "Video hazır ama veritabanı güncellenemedi.");
      }
      const moderation = result.moderationQueued ? await runListingModeration(result.vehicleId) : null;
      return NextResponse.json({
        ok: true,
        vehicleId: result.vehicleId,
        published: moderation?.status === "decided" && moderation.published,
        decision: moderation?.status === "decided" ? moderation.decision : null,
      });
    }

    if (attempt < MAX_POLL_ATTEMPTS - 1) await sleep(POLL_INTERVAL_MS);
  }

  return errorResponse(
    202,
    "still_processing",
    "Video Cloudflare'de hâlâ işleniyor. Birkaç saniye sonra tekrar dene.",
  );
}
