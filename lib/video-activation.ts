import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModerationStatus, VehicleStatus } from "./listing-status";

// Video hazır olunca ilan doğrudan yayına alınmaz: önce içerik denetimine
// ('pending_moderation') girer; yayına alma kararını lib/listing-moderation.ts
// verir. Bu durumlardaki ilan karantinaya alınır:
const QUARANTINABLE_STATUSES: readonly VehicleStatus[] = ["draft", "pending_video"];

export type VideoReadyInput = {
  streamUid: string;
  hlsUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
};

export type ActivationResult =
  | { ok: true; vehicleId: string; moderationQueued: boolean }
  | { ok: false; error: "unknown_video" | "database_error" };

/**
 * Video hazır olduğunda videos satırını 'ready' yapar ve ilanı içerik
 * denetimine hazırlar. moderationQueued: true ise çağıran,
 * runListingModeration(vehicleId) ile denetimi başlatmalı.
 *
 *   draft / pending_video           → 'pending_moderation' (akışta görünmez)
 *   denetimi bekleyen başka durumlar → durum aynı, denetlenir (ör. satıcı
 *                                      ilanı video işlenirken arşive aldıysa)
 *   karar verilmiş ilana yeni video  → karar sıfırlanır, yayındaysa
 *                                      'pending_moderation'a döner, yeniden denetlenir
 *   satılmış / reddedilmiş ilan      → dokunulmaz
 *
 * Üretimde bunu Cloudflare webhook'u çağırır (app/api/webhooks/cloudflare);
 * yerel geliştirmede app/api/dev/complete-upload.
 */
export async function markVideoReadyAndQueueModeration(
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

  const vehicleId: string = video.vehicle_id;
  const { data: vehicle, error: readError } = await supabase
    .from("vehicles")
    .select("status, moderation_status")
    .eq("id", vehicleId)
    .maybeSingle();

  if (readError || !vehicle) {
    console.error("İlan okunamadı:", vehicleId, readError);
    return { ok: false, error: "database_error" };
  }

  const status = vehicle.status as VehicleStatus;
  const moderationStatus = vehicle.moderation_status as ModerationStatus;
  if (status === "sold" || status === "rejected") return { ok: true, vehicleId, moderationQueued: false };

  let error: unknown = null;
  if (moderationStatus !== "pending") {
    // Onaydan sonra gelen video (ör. aynı ilana ikinci yükleme) denetlenmeden yayında kalamaz
    ({ error } = await supabase
      .from("vehicles")
      .update({
        moderation_status: "pending",
        moderation_reason: null,
        moderated_at: null,
        ...(status === "active" ? { status: "pending_moderation" } : {}),
      })
      .eq("id", vehicleId)
      .eq("moderation_status", moderationStatus));
  } else if (QUARANTINABLE_STATUSES.includes(status)) {
    ({ error } = await supabase
      .from("vehicles")
      .update({ status: "pending_moderation" })
      .eq("id", vehicleId)
      .in("status", QUARANTINABLE_STATUSES));
  }

  if (error) {
    console.error("İlan içerik denetimine alınamadı:", vehicleId, error);
    return { ok: false, error: "database_error" };
  }
  return { ok: true, vehicleId, moderationQueued: true };
}
