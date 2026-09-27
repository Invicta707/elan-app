import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AVATAR_REJECTED_MESSAGE,
  AVATAR_UNAVAILABLE_MESSAGE,
  MAX_FAILURES,
  MAX_FAILURE_LENGTH,
  combineVerdicts,
  decide,
  localTextScores,
  unavailableVerdict,
  type ModerationVerdict,
} from "./content-moderation";
import { isRetryableProviderError, type ImageInput, type ImageModerator, type TextModerator } from "./moderation-providers";

// Görsel ve metin denetiminin sunucu tarafı: sağlayıcı çağrıları, hata
// politikası ve denetim kaydı. İlan hattı: lib/listing-moderation.ts.

/**
 * Aynı anda en fazla bu kadar görsel isteği. Sightengine Free/Starter belgede
 * saniyede 1 istek diyor; 27 Eylül 2026'da canlıda 8 eşzamanlı istek hatasız
 * geçti. Aşılırsa 429 gelir ve aşağıdaki gecikmeli yeniden deneme karşılar.
 */
export const IMAGE_CONCURRENCY = 4;

/**
 * Geçici hatada (ağ, zaman aşımı, 5xx, 429, görsel henüz indirilemedi) yeniden
 * denemeden önceki beklemeler: 3 deneme. Hemen tekrar denemek, birkaç saniye
 * sonra hazır olacak bir kareyi kurtarmıyordu.
 */
export const IMAGE_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000];

export type ImageModerationOptions = {
  /** Bu zamandan (epoch ms) sonra yeni istek ya da bekleme başlatılmaz */
  deadline?: number;
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Tek görsel. Geçici hatada beklenip yeniden denenir; olmazsa "denetlenemedi"
 * (flagged): denetlenmemiş içerik temiz sayılmaz. Neden (hangi görsel, hangi
 * hata) karara yazılır.
 */
export async function moderateImage(
  moderator: ImageModerator | null,
  input: ImageInput,
  { deadline, retryDelaysMs = IMAGE_RETRY_DELAYS_MS, sleep = defaultSleep, now = Date.now }: ImageModerationOptions = {},
): Promise<ModerationVerdict> {
  if (!moderator) return unavailableVerdict("none");
  let lastError: unknown;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return decide(await moderator.moderate(input), moderator.name);
    } catch (error) {
      lastError = error;
      const delay = retryDelaysMs[attempt];
      if (delay === undefined || !isRetryableProviderError(error) || (deadline !== undefined && now() + delay > deadline)) break;
      await sleep(delay);
    }
  }
  const failure = `${input.label ?? "görsel"}: ${errorText(lastError)}`;
  console.error(`İçerik denetimi (${moderator.name}) denetleyemedi: ${failure}`);
  return unavailableVerdict(moderator.name, failure);
}

/**
 * Birden fazla görsel (video kareleri, fotoğraflar). Sırayla, aynı anda en fazla
 * IMAGE_CONCURRENCY istek; bir görsel reddedilince yenisi başlatılmaz (sonuç
 * zaten ret, sağlayıcı kotası harcanmaz). Süre dolunca kalan görseller
 * denetlenemedi sayılır.
 */
export async function moderateImages(
  moderator: ImageModerator | null,
  inputs: readonly ImageInput[],
  options: ImageModerationOptions = {},
): Promise<ModerationVerdict> {
  if (inputs.length === 0) return combineVerdicts([]);
  if (!moderator) return unavailableVerdict("none");
  const now = options.now ?? Date.now;
  const provider = moderator.name;

  const verdicts: ModerationVerdict[] = [];
  let next = 0;
  let stop = false;
  async function worker() {
    while (!stop && next < inputs.length) {
      const input = inputs[next++];
      if (options.deadline !== undefined && now() > options.deadline) {
        verdicts.push(unavailableVerdict(provider, `${input.label ?? "görsel"}: süre doldu, denetlenmedi`));
        continue;
      }
      const verdict = await moderateImage(moderator, input, options);
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
    console.error(`İçerik denetimi (${moderator.name}) metni denetleyemedi:`, errorText(error));
    return onProviderError === "flag"
      ? combineVerdicts([local, unavailableVerdict(moderator.name, `metin: ${errorText(error)}`)])
      : local;
  }
}

/**
 * Profil fotoğrafında kullanıcı yanıtı bekliyor: tek yeniden deneme, kısa
 * beklemeyle (ilan hattı arka planda çalıştığı için daha sabırlı).
 */
export const AVATAR_RETRY_DELAYS_MS: readonly number[] = [1_000];

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
  { sleep }: Pick<ImageModerationOptions, "sleep"> = {},
): Promise<UploadModeration> {
  const verdict = await moderateImage(moderator, { bytes, mimeType, label: "profil fotoğrafı" }, {
    retryDelaysMs: AVATAR_RETRY_DELAYS_MS,
    sleep,
  });
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

/**
 * Denetim kaydı (content_moderation_events). İçeriğin kendisi yazılmaz. Hata isteği düşürmez.
 * failures (denetlenemeyen görsel ve nedeni) yalnızca varsa yazılır.
 */
export async function recordModerationEvent(supabase: SupabaseClient, event: ModerationEvent): Promise<void> {
  const scores = Object.fromEntries(
    Object.entries(event.verdict.scores).map(([category, score]) => [category, Math.round(score * 10_000) / 10_000]),
  );
  const failures = (event.verdict.failures ?? []).slice(0, MAX_FAILURES).map((line) => line.slice(0, MAX_FAILURE_LENGTH));
  const { error } = await supabase.from("content_moderation_events").insert({
    subject_type: event.subjectType,
    subject_id: event.subjectId,
    user_id: event.userId,
    moderator_id: event.moderatorId ?? null,
    provider: event.verdict.provider,
    decision: event.verdict.decision,
    reasons: event.verdict.reasons,
    scores,
    ...(failures.length > 0 ? { failures } : {}),
  });
  if (error) console.error("İçerik denetimi kaydı yazılamadı:", error);
}
