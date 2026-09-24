import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Video hazır olunca sadece bu durumlardaki ilanlar yayına alınır. Satılmış,
// arşivlenmiş ya da zaten yayındaki ilanların durumuna dokunulmaz.
const ACTIVATABLE_VEHICLE_STATUSES = ["draft", "pending_video"];

export type VideoReadyInput = {
  streamUid: string;
  hlsUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
};

export type ActivationResult =
  | { ok: true; vehicleId: string; vehicleActivated: boolean }
  | { ok: false; error: "unknown_video" | "database_error" };

/**
 * Video hazır olduğunda videos satırını 'ready' yapar ve ilanı (draft/pending_video
 * ise) 'active'e alır. Üretimde bunu Cloudflare webhook'u çağırır (bkz.
 * app/api/webhooks/cloudflare/route.ts); yerel geliştirmede webhook Cloudflare'den
 * localhost'a ulaşamadığı için app/api/dev/complete-upload aynı fonksiyonu
 * doğrudan çağırır (bkz. o dosyadaki açıklama).
 */
export async function markVideoReadyAndActivateVehicle(
  supabase: SupabaseClient,
  input: VideoReadyInput,
): Promise<ActivationResult> {
  const { data: video, error: videoError } = await supabase
    .from("videos")
    .update({
      status: "ready",
      hls_url: input.hlsUrl,
      thumbnail_url: input.thumbnailUrl,
      duration_seconds: input.durationSeconds,
    })
    .eq("stream_uid", input.streamUid)
    .select("vehicle_id")
    .maybeSingle();

  if (videoError) {
    console.error("Video 'ready' olarak güncellenemedi:", input.streamUid, videoError);
    return { ok: false, error: "database_error" };
  }
  if (!video) {
    return { ok: false, error: "unknown_video" };
  }

  const { data: activated, error: vehicleError } = await supabase
    .from("vehicles")
    .update({ status: "active" })
    .eq("id", video.vehicle_id)
    .in("status", ACTIVATABLE_VEHICLE_STATUSES)
    .select("id");

  if (vehicleError) {
    console.error("İlan yayına alınamadı:", video.vehicle_id, vehicleError);
    return { ok: false, error: "database_error" };
  }

  return {
    ok: true,
    vehicleId: video.vehicle_id,
    vehicleActivated: (activated?.length ?? 0) > 0,
  };
}
