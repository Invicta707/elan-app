import { NextResponse, after } from "next/server";
import { verifyWebhookSignature, type StreamWebhookPayload } from "../../../../lib/cloudflare";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";
import { runListingModeration } from "../../../../lib/listing-moderation";
import { markVideoReadyAndQueueModeration } from "../../../../lib/video-activation";

// POST /api/webhooks/cloudflare
//
// Cloudflare Stream, video işlenince (ready) ya da işlenemeyince (error) buraya
// imzalı bir POST gönderir. Hesap başına tek webhook adresi olabilir:
//   PUT https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/stream/webhook
//   {"notificationUrl": "https://<alan-adın>/api/webhooks/cloudflare"}
// Yanıttaki "secret" değeri CLOUDFLARE_STREAM_WEBHOOK_SECRET olarak saklanır.
//
// Cloudflare aynı bildirimi birden fazla gönderebilir; tüm güncellemeler tekrar
// çalıştırılabilir (idempotent). 5xx dönülen bildirimler tekrar denenebilir.
//
// Video hazır olunca ilan yayına değil içerik denetimine girer
// ('pending_moderation'); temiz çıkarsa yönetici onayını bekler ('pending_approval'). Denetim (video kareleri, fotoğraflar, açıklama) yanıt
// gönderildikten sonra after() içinde çalışır: Cloudflare beklemez, sağlayıcı
// yavaşsa bile bildirim zaman aşımına düşmez. Denetim yarıda kalırsa ilan
// incelemede kalır (bkz. lib/listing-moderation.ts runListingModeration).

/** after() içindeki denetim bu süreye kadar çalışabilir (kareler + fotoğraflar) */
export const maxDuration = 60;

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  const secret = process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error("CLOUDFLARE_STREAM_WEBHOOK_SECRET tanımlı değil; webhook işlenemiyor.");
    return json(500, { error: "webhook_not_configured" });
  }

  // İmza ham gövde üzerinden doğrulanır; JSON'a çevirmeden önce byte olarak okunuyor
  const rawBody = Buffer.from(await request.arrayBuffer());
  if (!verifyWebhookSignature(rawBody, request.headers.get("webhook-signature"), secret)) {
    return json(401, { error: "invalid_signature" });
  }

  let payload: StreamWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as StreamWebhookPayload;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const streamUid = payload.uid;
  if (typeof streamUid !== "string" || streamUid === "") {
    return json(400, { error: "missing_uid" });
  }

  const supabase = getSupabaseAdmin();
  const state = payload.status?.state;

  // --- Video hazır ---
  if (state === "ready" && payload.readyToStream && payload.playback?.hls) {
    const result = await markVideoReadyAndQueueModeration(supabase, {
      streamUid,
      hlsUrl: payload.playback.hls,
      thumbnailUrl: payload.thumbnail ?? null,
      durationSeconds:
        typeof payload.duration === "number" && payload.duration > 0
          ? Math.round(payload.duration)
          : null,
    });

    if (!result.ok) {
      if (result.error === "unknown_video") {
        // Bu uygulamanın açmadığı (ya da satıcının sildiği) bir video: onayla ve geç
        console.warn("Webhook: kayıtlı olmayan video uid'si, yok sayıldı:", streamUid);
        return json(200, { ok: true, ignored: "unknown_video" });
      }
      return json(500, { error: "database_error" });
    }

    if (result.moderationQueued) {
      const vehicleId = result.vehicleId;
      after(() => runListingModeration(vehicleId));
    }
    return json(200, { ok: true, moderationQueued: result.moderationQueued });
  }

  // --- Video işlenemedi ---
  if (state === "error") {
    const reason =
      payload.status?.errorReasonCode || payload.status?.errReasonCode || "ERR_UNKNOWN";

    const { error } = await supabase
      .from("videos")
      .update({ status: "failed" })
      .eq("stream_uid", streamUid);

    if (error) {
      console.error("Video 'failed' olarak güncellenemedi:", streamUid, error);
      return json(500, { error: "database_error" });
    }

    console.warn(`Cloudflare videoyu işleyemedi (${streamUid}): ${reason}`);
    return json(200, { ok: true, reason });
  }

  // Diğer durumlar (queued, inprogress vb.) için yapılacak bir şey yok
  return json(200, { ok: true, ignored: state ?? "unknown_state" });
}