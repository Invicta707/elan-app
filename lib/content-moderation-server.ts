import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AVATAR_REJECTED_MESSAGE,
  AVATAR_UNAVAILABLE_MESSAGE,
  combineVerdicts,
  decide,
  localTextScores,
  unavailableVerdict,
  type ModerationVerdict,
} from "./content-moderation";
import type { ImageInput, ImageModerator, TextModerator } from "./moderation-providers";

// Görsel ve metin denetiminin sunucu tarafı: sağlayıcı çağrıları, hata
// politikası ve denetim kaydı. İlan hattı: lib/listing-moderation.ts.

/** Aynı anda en fazla bu kadar görsel isteği (sağlayıcı hız sınırları) */
export const IMAGE_CONCURRENCY = 4;

/**
 * Tek görsel. Sağlayıcı hata verirse bir kez daha denenir; yine olmazsa
 * "denetlenemedi" (flagged): denetlenmemiş içerik temiz sayılmaz.
 */
export async function moderateImage(moderator: ImageModerator | null, input: ImageInput): Promise<ModerationVerdict> {
  if (!moderator) return unavailableVerdict("none");
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return decide(await moderator.moderate(input), moderator.name);
    } catch (error) {
      if (attempt === 2) {
        console.error(`İçerik denetimi (${moderator.name}) görseli denetleyemedi:`, error instanceof Error ? error.message : error);
      }
    }
  }
  return unavailableVerdict(moderator.name);
}

/**
 * Birden fazla görsel (video kareleri, fotoğraflar). Sırayla, aynı anda en fazla
 * IMAGE_CONCURRENCY istek; bir görsel reddedilince yenisi başlatılmaz (sonuç
 * zaten ret, sağlayıcı kotası harcanmaz).
 */
export async function moderateImages(
  moderator: ImageModerator | null,
  inputs: readonly ImageInput[],
): Promise<ModerationVerdict> {
  if (inputs.length === 0) return combineVerdicts([]);
  if (!moderator) return unavailableVerdict("none");

  const verdicts: ModerationVerdict[] = [];
  let next = 0;
  let stop = false;
  async function worker() {
    while (!stop && next < inputs.length) {
      const verdict = await moderateImage(moderator, inputs[next++]);
      verdicts.push(verdict);
      if (verdict.decision === "rejected") stop = true;
    }
  }
  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, inputs.length) }, worker));
  return combineVerdicts(verdicts);
}

/**
 * Metin: önce temel filtre (lib/text-moderation.ts; ücretsiz, anında). Ona
 * takılmadıysa ve sağlayıcı varsa OpenAI Moderation.
 * onProviderError: sağlayıcı hata verirse ne olacağı. "flag": insan incelemesi
 * (ilan metni). "allow": temel filtrenin sonucu geçerli (mesaj; taban kural
 * veritabanında da var, sohbet sağlayıcı yüzünden durmasın).
 */
export async function moderateText(
  moderator: TextModerator | null,
  text: string,
  { onProviderError }: { onProviderError: "flag" | "allow" },
): Promise<ModerationVerdict> {
  const local = decide(localTextScores(text), "local");
  if (local.decision === "rejected" || !moderator || !text.trim()) return local;
  try {
    return combineVerdicts([local, decide(await moderator.moderate(text), moderator.name)]);
  } catch (error) {
    console.error(`İçerik denetimi (${moderator.name}) metni denetleyemedi:`, error instanceof Error ? error.message : error);
    return onProviderError === "flag" ? combineVerdicts([local, unavailableVerdict(moderator.name)]) : local;
  }
}

export type UploadModeration =
  | { allowed: true; verdict: ModerationVerdict }
  | { allowed: false; status: 422 | 503; message: string; verdict: ModerationVerdict };

/**
 * Profil fotoğrafı: yalnızca "safe" kabul edilir. İnceleme kuyruğu olmadığı
 * için şüpheli (flagged) fotoğraf da reddedilir; kullanıcı başka fotoğraf seçer.
 * Denetlenemezse (sağlayıcı yok ya da hata) 503: denetimsiz fotoğraf yayına girmez.
 */
export async function moderateAvatarUpload(
  moderator: ImageModerator | null,
  bytes: Uint8Array,
  mimeType: string,
): Promise<UploadModeration> {
  const verdict = await moderateImage(moderator, { bytes, mimeType });
  if (verdict.decision === "safe") return { allowed: true, verdict };
  if (verdict.reasons.includes("unavailable")) {
    return { allowed: false, status: 503, message: AVATAR_UNAVAILABLE_MESSAGE, verdict };
  }
  return { allowed: false, status: 422, message: AVATAR_REJECTED_MESSAGE, verdict };
}

export type ModerationEvent = {
  subjectType: "listing" | "avatar" | "message";
  subjectId: string | null;
  /** İçeriğin sahibi */
  userId: string | null;
  /** Elle verilen kararda yönetici */
  moderatorId?: string | null;
  verdict: ModerationVerdict;
};

/** Denetim kaydı (content_moderation_events). İçeriğin kendisi yazılmaz. Hata isteği düşürmez. */
export async function recordModerationEvent(supabase: SupabaseClient, event: ModerationEvent): Promise<void> {
  const scores = Object.fromEntries(
    Object.entries(event.verdict.scores).map(([category, score]) => [category, Math.round(score * 10_000) / 10_000]),
  );
  const { error } = await supabase.from("content_moderation_events").insert({
    subject_type: event.subjectType,
    subject_id: event.subjectId,
    user_id: event.userId,
    moderator_id: event.moderatorId ?? null,
    provider: event.verdict.provider,
    decision: event.verdict.decision,
    reasons: event.verdict.reasons,
    scores,
  });
  if (error) console.error("İçerik denetimi kaydı yazılamadı:", error);
}
