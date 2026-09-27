import "server-only";
import { signAwsRequest, type AwsCredentials } from "./aws-sigv4";
import { probability, type CategoryScores } from "./content-moderation";

// İçerik denetimi sağlayıcıları. Her sağlayıcı kendi yanıtını ortak kategorilere
// (lib/content-moderation.ts CategoryScores) çevirir; karar ve eşikler orada.
//
// Seçim ortam değişkenleriyle (bkz. .env.example, moderationProvidersFromEnv):
//   Görsel: MODERATION_IMAGE_PROVIDER = sightengine | rekognition | openai | none
//           (boşsa anahtarı tanımlı ilk sağlayıcı, bu sırayla)
//   Metin:  OPENAI_API_KEY tanımlıysa OpenAI Moderation (MODERATION_TEXT_PROVIDER=none kapatır)
// Görsel sağlayıcı yoksa denetim "yapılamadı" sayılır: ilanlar yayına girmez,
// yönetim panelinde insan onayı bekler; avatar yüklenemez.

/**
 * label: denetlenemezse kayda yazılan ad ("kapak", "kare 8 sn", "fotoğraf 2");
 * sağlayıcıya gitmez.
 */
export type ImageInput = ({ url: string } | { bytes: Uint8Array; mimeType: string }) & { label?: string };

export interface ImageModerator {
  readonly name: string;
  moderate(input: ImageInput): Promise<CategoryScores>;
}

export interface TextModerator {
  readonly name: string;
  moderate(text: string): Promise<CategoryScores>;
}

export type ModerationProviders = { image: ImageModerator | null; text: TextModerator | null };

/**
 * Sağlayıcıya ulaşılamadı ya da yanıt beklenen biçimde değil.
 * retryable: biraz sonra tekrar denemek işe yarayabilir (5xx, 429, görsel
 * indirilemedi). Anahtar, istek ya da kota hatası tekrarla düzelmez.
 */
export class ModerationProviderError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(message: string, { retryable = false, status = null }: { retryable?: boolean; status?: number | null } = {}) {
    super(message);
    this.name = "ModerationProviderError";
    this.retryable = retryable;
    this.status = status;
  }
}

/**
 * Tekrar denenebilir mi? Sağlayıcının kendi hatası sınıflandırılmıştır; ağ
 * hatası ve zaman aşımı (TypeError, AbortError/TimeoutError) geçicidir.
 */
export function isRetryableProviderError(error: unknown): boolean {
  return error instanceof ModerationProviderError ? error.retryable : true;
}

/**
 * Sightengine hata türleri (https://sightengine.com/docs/api-error-codes-and-responses):
 * media_error: görsel indirilemedi/açılamadı (ör. kaynak 404; biraz sonra hazır
 * olabilir), api_error / unknown_error: sağlayıcı tarafı. Diğerleri (argument_error,
 * credentials_error, usage_limit, plan_error, request_error) tekrarla düzelmez.
 */
const RETRYABLE_ERROR_TYPES = new Set(["media_error", "api_error", "unknown_error"]);

function errorType(body: unknown): string | undefined {
  const type = (body as { error?: { type?: unknown } } | null)?.error?.type;
  return typeof type === "string" ? type : undefined;
}

type FetchImpl = typeof fetch;

/** Tek bir sağlayıcı isteğinin en uzun süresi */
export const PROVIDER_TIMEOUT_MS = 15_000;

/** Hata gövdesindeki mesaj: { message } | { Message } (AWS) | { error: "…" } | { error: { message } } */
function errorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const { error, message, Message } = body as { error?: unknown; message?: unknown; Message?: unknown };
  if (typeof message === "string") return message;
  if (typeof Message === "string") return Message;
  if (typeof error === "string") return error;
  const nested = (error as { message?: unknown } | null)?.message;
  return typeof nested === "string" ? nested : undefined;
}

async function readJson(response: Response, provider: string): Promise<unknown> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const type = errorType(body);
    throw new ModerationProviderError(
      `${provider} ${response.status}${type ? ` ${type}` : ""}: ${errorMessage(body) ?? response.statusText}`,
      {
        status: response.status,
        retryable: response.status >= 500 || response.status === 429 || (type !== undefined && RETRYABLE_ERROR_TYPES.has(type)),
      },
    );
  }
  // JSON olmayan başarılı yanıt: büyük olasılıkla ara katmanın hata sayfası
  if (body === null) throw new ModerationProviderError(`${provider}: yanıt JSON değil`, { retryable: true, status: response.status });
  return body;
}

const max = (...values: unknown[]) => Math.max(0, ...values.map(probability));

// ---------------------------------------------------------------
// Sightengine (https://sightengine.com/docs)
// ---------------------------------------------------------------

/** nudity-2.1: çıplaklık/cinsellik, weapon: silah, violence: şiddet, gore-2.0: kan/yaralanma */
export const SIGHTENGINE_MODELS = "nudity-2.1,weapon,violence,gore-2.0";
const SIGHTENGINE_URL = "https://api.sightengine.com/1.0/check.json";

type SightengineResponse = {
  status?: string;
  error?: { message?: string };
  nudity?: Record<string, unknown>;
  weapon?: { classes?: Record<string, unknown> };
  violence?: { prob?: unknown };
  gore?: { prob?: unknown };
};

/**
 * Sightengine yanıtı → kategoriler. İstenen modellerden biri yanıtta yoksa
 * hata: eksik denetim "temiz" sayılmaz.
 */
export function parseSightengineResponse(raw: unknown): CategoryScores {
  const body = (raw ?? {}) as SightengineResponse;
  if (body.status !== "success") {
    const type = errorType(body);
    throw new ModerationProviderError(`sightengine${type ? ` ${type}` : ""}: ${body.error?.message ?? "başarısız yanıt"}`, {
      retryable: type !== undefined && RETRYABLE_ERROR_TYPES.has(type),
    });
  }
  const { nudity, weapon, violence, gore } = body;
  if (!nudity || !weapon || !violence || !gore) {
    throw new ModerationProviderError("sightengine: yanıtta istenen modellerin sonucu eksik");
  }
  return {
    sexual: max(nudity.sexual_activity, nudity.sexual_display, nudity.erotica),
    suggestive: max(nudity.very_suggestive),
    violence: max(violence.prob),
    gore: max(gore.prob),
    // Oyuncak, jest ve çizim silahlar sayılmaz
    weapon: max(weapon.classes?.firearm, weapon.classes?.knife),
  };
}

export function createSightengineModerator({
  apiUser,
  apiSecret,
  fetchImpl = fetch,
}: {
  apiUser: string;
  apiSecret: string;
  fetchImpl?: FetchImpl;
}): ImageModerator {
  return {
    name: "sightengine",
    async moderate(input) {
      let response: Response;
      if ("url" in input) {
        // Adres modunda Sightengine görseli kendisi indirir (belgelenen GET biçimi)
        const params = new URLSearchParams({
          url: input.url,
          models: SIGHTENGINE_MODELS,
          api_user: apiUser,
          api_secret: apiSecret,
        });
        response = await fetchImpl(`${SIGHTENGINE_URL}?${params}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        });
      } else {
        const form = new FormData();
        form.set("media", new Blob([input.bytes as BlobPart], { type: input.mimeType }), "upload");
        form.set("models", SIGHTENGINE_MODELS);
        form.set("api_user", apiUser);
        form.set("api_secret", apiSecret);
        response = await fetchImpl(SIGHTENGINE_URL, {
          method: "POST",
          body: form,
          cache: "no-store",
          signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        });
      }
      return parseSightengineResponse(await readJson(response, "sightengine"));
    },
  };
}

// ---------------------------------------------------------------
// AWS Rekognition DetectModerationLabels
// ---------------------------------------------------------------

/** Rekognition görseli yalnızca bayt olarak (en fazla 5 MB) alır */
export const REKOGNITION_MAX_BYTES = 5 * 1024 * 1024;

const labelKey = (name: unknown) => (typeof name === "string" ? name.toLowerCase().replace(/[^a-z0-9]/g, "") : "");

/** Etiket adı → kategori (sürüm 6 ve 7 taksonomisi; ad küçük harf ve yalnızca harf/rakam) */
const REKOGNITION_LABELS: Record<string, keyof typeof REKOGNITION_CATEGORY_NAMES> = {};
const REKOGNITION_CATEGORY_NAMES = {
  sexual: [
    "Explicit",
    "Explicit Nudity",
    "Explicit Sexual Activity",
    "Sexual Activity",
    "Sex Toys",
    "Adult Toys",
    "Nudity",
    "Graphic Male Nudity",
    "Graphic Female Nudity",
    "Illustrated Explicit Nudity",
    "Exposed Male Genitalia",
    "Exposed Female Genitalia",
    "Exposed Buttocks or Anus",
    "Exposed Female Nipple",
  ],
  suggestive: [
    "Suggestive",
    "Non-Explicit Nudity of Intimate parts and Kissing",
    "Non-Explicit Nudity",
    "Swimwear or Underwear",
    "Female Swimwear Or Underwear",
    "Male Swimwear Or Underwear",
    "Partial Nudity",
    "Revealing Clothes",
    "Obstructed Intimate Parts",
    "Kissing on the Lips",
  ],
  violence: ["Violence", "Graphic Violence", "Physical Violence", "Graphic Violence Or Gore"],
  gore: ["Blood & Gore", "Death and Emaciation", "Emaciated Bodies", "Corpses", "Hanging"],
  weapon: ["Weapons", "Weapon Violence"],
  self_harm: ["Self-Harm", "Self Injury"],
  hate: ["Hate Symbols", "Nazi Party", "White Supremacy", "Extremist"],
} as const;
for (const [category, names] of Object.entries(REKOGNITION_CATEGORY_NAMES)) {
  for (const name of names) REKOGNITION_LABELS[labelKey(name)] = category as keyof typeof REKOGNITION_CATEGORY_NAMES;
}
/**
 * Hiç sayılmayan etiketler. "Crashes" (kaza) ve üst etiketi "Visually
 * Disturbing": hasarlı araç ilanları bu platformun olağan içeriği. Üst etiketin
 * puanı altındaki en güçlü etiketten gelir; kan/ölüm gibi gerçekten rahatsız
 * edici alt etiketler yukarıda ayrıca eşleniyor.
 */
const REKOGNITION_IGNORED = new Set(["crashes", "aircrash", "visuallydisturbing", "explosionsandblasts"]);

type RekognitionLabel = { Name?: unknown; ParentName?: unknown; Confidence?: unknown };

export function parseRekognitionResponse(raw: unknown): CategoryScores {
  const labels = (raw as { ModerationLabels?: RekognitionLabel[] } | null)?.ModerationLabels;
  if (!Array.isArray(labels)) throw new ModerationProviderError("rekognition: yanıtta ModerationLabels yok");

  const scores: CategoryScores = {};
  for (const label of labels) {
    const name = labelKey(label.Name);
    if (REKOGNITION_IGNORED.has(name)) continue;
    const parent = labelKey(label.ParentName);
    const category = REKOGNITION_LABELS[name] ?? (REKOGNITION_IGNORED.has(parent) ? undefined : REKOGNITION_LABELS[parent]);
    if (!category) continue;
    const confidence = typeof label.Confidence === "number" ? label.Confidence / 100 : 0;
    scores[category] = Math.max(scores[category] ?? 0, probability(confidence));
  }
  return scores;
}

/** Görseli indirir (yalnızca https, en fazla maxBytes) */
export async function fetchImageBytes(
  url: string,
  { fetchImpl = fetch, maxBytes = REKOGNITION_MAX_BYTES }: { fetchImpl?: FetchImpl; maxBytes?: number } = {},
): Promise<Uint8Array> {
  if (!url.startsWith("https://")) throw new ModerationProviderError("görsel adresi https değil");
  const response = await fetchImpl(url, { cache: "no-store", signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  if (!response.ok) {
    // 404: kare henüz üretilmemiş olabilir (Cloudflare); 5xx/429 geçici
    const retryable = response.status === 404 || response.status === 429 || response.status >= 500;
    throw new ModerationProviderError(`görsel indirilemedi: ${response.status}`, { retryable, status: response.status });
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new ModerationProviderError("görsel denetim için çok büyük");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxBytes) throw new ModerationProviderError("görsel boş ya da çok büyük");
  return bytes;
}

export function createRekognitionModerator({
  region,
  credentials,
  fetchImpl = fetch,
  now,
}: {
  region: string;
  credentials: AwsCredentials;
  fetchImpl?: FetchImpl;
  now?: () => Date;
}): ImageModerator {
  const endpoint = `https://rekognition.${region}.amazonaws.com/`;
  return {
    name: "rekognition",
    async moderate(input) {
      const bytes = "url" in input ? await fetchImageBytes(input.url, { fetchImpl }) : input.bytes;
      if (bytes.length > REKOGNITION_MAX_BYTES) throw new ModerationProviderError("görsel denetim için çok büyük");
      const body = JSON.stringify({
        Image: { Bytes: Buffer.from(bytes).toString("base64") },
        // İnceleme eşiğinin altındaki etiketler gerekmez
        MinConfidence: 40,
      });
      const signed = signAwsRequest({
        method: "POST",
        url: endpoint,
        headers: {
          "content-type": "application/x-amz-json-1.1",
          "x-amz-target": "RekognitionService.DetectModerationLabels",
        },
        body,
        region,
        service: "rekognition",
        credentials,
        now: now?.(),
      });
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: signed.headers,
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      return parseRekognitionResponse(await readJson(response, "rekognition"));
    },
  };
}

// ---------------------------------------------------------------
// OpenAI Moderation (metin ve görsel; ücretsiz uç)
// ---------------------------------------------------------------

export const OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations";
export const OPENAI_DEFAULT_MODEL = "omni-moderation-latest";

/** OpenAI kategori puanları → ortak kategoriler. Görselde yalnızca cinsellik, şiddet ve kendine zarar puanlanır. */
export function parseOpenAiModeration(raw: unknown): CategoryScores {
  const result = (raw as { results?: { category_scores?: Record<string, unknown> }[] } | null)?.results?.[0];
  const s = result?.category_scores;
  if (!s) throw new ModerationProviderError("openai: yanıtta category_scores yok");
  return {
    sexual: max(s.sexual),
    sexual_minors: max(s["sexual/minors"]),
    harassment: max(s.harassment, s["harassment/threatening"]),
    hate: max(s.hate, s["hate/threatening"]),
    illegal: max(s.illicit, s["illicit/violent"]),
    violence: max(s.violence),
    gore: max(s["violence/graphic"]),
    self_harm: max(s["self-harm"], s["self-harm/intent"], s["self-harm/instructions"]),
  };
}

export function createOpenAiModerators({
  apiKey,
  model = OPENAI_DEFAULT_MODEL,
  fetchImpl = fetch,
}: {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchImpl;
}): { image: ImageModerator; text: TextModerator } {
  async function call(input: unknown): Promise<CategoryScores> {
    const response = await fetchImpl(OPENAI_MODERATION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input }),
      cache: "no-store",
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    return parseOpenAiModeration(await readJson(response, "openai"));
  }

  return {
    image: {
      name: "openai",
      moderate(input) {
        const url =
          "url" in input
            ? input.url
            : `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`;
        return call([{ type: "image_url", image_url: { url } }]);
      },
    },
    text: { name: "openai", moderate: (text) => call(text) },
  };
}

// ---------------------------------------------------------------
// Ortam değişkenlerinden seçim
// ---------------------------------------------------------------

type Env = Record<string, string | undefined>;
const value = (env: Env, name: string) => env[name]?.trim() || undefined;

export type ImageProviderName = "sightengine" | "rekognition" | "openai";

function buildImageModerator(name: ImageProviderName, env: Env, fetchImpl: FetchImpl): ImageModerator | null {
  switch (name) {
    case "sightengine": {
      const apiUser = value(env, "SIGHTENGINE_API_USER");
      const apiSecret = value(env, "SIGHTENGINE_API_SECRET");
      return apiUser && apiSecret ? createSightengineModerator({ apiUser, apiSecret, fetchImpl }) : null;
    }
    case "rekognition": {
      // AWS_* adları Vercel'de ayrılmış; bu yüzden REKOGNITION_* kullanılıyor
      const accessKeyId = value(env, "REKOGNITION_ACCESS_KEY_ID");
      const secretAccessKey = value(env, "REKOGNITION_SECRET_ACCESS_KEY");
      if (!accessKeyId || !secretAccessKey) return null;
      return createRekognitionModerator({
        region: value(env, "REKOGNITION_REGION") ?? "eu-central-1",
        credentials: { accessKeyId, secretAccessKey, sessionToken: value(env, "REKOGNITION_SESSION_TOKEN") },
        fetchImpl,
      });
    }
    case "openai": {
      const apiKey = value(env, "OPENAI_API_KEY");
      return apiKey
        ? createOpenAiModerators({ apiKey, model: value(env, "OPENAI_MODERATION_MODEL"), fetchImpl }).image
        : null;
    }
  }
}

const IMAGE_PROVIDER_ORDER: readonly ImageProviderName[] = ["sightengine", "rekognition", "openai"];

export function moderationProvidersFromEnv(
  env: Env = process.env,
  fetchImpl: FetchImpl = fetch,
): ModerationProviders {
  const chosen = value(env, "MODERATION_IMAGE_PROVIDER")?.toLowerCase();
  let image: ImageModerator | null = null;
  if (chosen === "none") {
    image = null;
  } else if (chosen) {
    if ((IMAGE_PROVIDER_ORDER as readonly string[]).includes(chosen)) {
      image = buildImageModerator(chosen as ImageProviderName, env, fetchImpl);
      if (!image) console.error(`İçerik denetimi: ${chosen} seçili ama anahtarları tanımlı değil.`);
    } else {
      console.error(`İçerik denetimi: bilinmeyen MODERATION_IMAGE_PROVIDER "${chosen}".`);
    }
  } else {
    for (const name of IMAGE_PROVIDER_ORDER) {
      image = buildImageModerator(name, env, fetchImpl);
      if (image) break;
    }
  }

  const apiKey = value(env, "OPENAI_API_KEY");
  const text =
    apiKey && value(env, "MODERATION_TEXT_PROVIDER")?.toLowerCase() !== "none"
      ? createOpenAiModerators({ apiKey, model: value(env, "OPENAI_MODERATION_MODEL"), fetchImpl }).text
      : null;

  return { image, text };
}
