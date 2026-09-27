import { textModerationCategory } from "./text-moderation";

// Otomatik içerik denetimi: kategoriler, eşikler ve karar. UI'dan ve
// sağlayıcılardan bağımsız.
//   Sağlayıcılar (Sightengine, AWS Rekognition, OpenAI): lib/moderation-providers.ts
//   Görsel/metin denetimi ve kayıt:                       lib/content-moderation-server.ts
//   İlan hattı (karantina, yayın, ret ve temizlik):       lib/listing-moderation.ts
//
// Not: lib/moderation.ts bildirilen ilanlar panelinin (/admin/reports)
// modülüdür; bu dosya otomatik denetimin kendisidir.

/** Sağlayıcıdan bağımsız kategoriler; her sağlayıcı kendi etiketlerini bunlara çevirir */
export type ModerationCategory =
  | "sexual"
  | "sexual_minors"
  | "suggestive"
  | "violence"
  | "gore"
  | "weapon"
  | "self_harm"
  | "harassment"
  | "hate"
  | "illegal"
  | "profanity";

/** 0–1 arası olasılıklar; eksik kategori 0 sayılır */
export type CategoryScores = Partial<Record<ModerationCategory, number>>;

/**
 * safe: yayına uygun. flagged: şüpheli ya da denetlenemedi; bir insan bakmalı.
 * rejected: kurala açıkça aykırı; otomatik reddedilir.
 */
export type ModerationDecision = "safe" | "flagged" | "rejected";

/** Kararın nedeni: eşiği aşan kategori ya da denetimin yapılamaması */
export type ModerationReason = ModerationCategory | "unavailable";

export type ModerationVerdict = {
  decision: ModerationDecision;
  /** En güçlü neden önce */
  reasons: ModerationReason[];
  scores: CategoryScores;
  provider: string;
  /**
   * Denetlenemeyen içerik ve nedeni ("kapak: sightengine 400 media_error: …").
   * content_moderation_events.failures'a yazılır: Vercel logları kısa süre
   * tutulduğu için "denetlenemedi"nin nedeni sonradan buradan okunur.
   */
  failures?: string[];
};

/** Bir kayıtta tutulan en fazla hata satırı ve satır uzunluğu */
export const MAX_FAILURES = 10;
export const MAX_FAILURE_LENGTH = 240;

/** Cinsel içerik / çıplaklık ve şiddet / kan / silah: bunun üstü otomatik ret */
export const REJECT_THRESHOLD = 0.6;
/** Bunun üstü (ret eşiğinin altı) insan incelemesine düşer */
export const REVIEW_THRESHOLD = 0.4;

/** reject: null → bu kategori tek başına ret sebebi değil, yalnızca incelemeye düşer */
export const THRESHOLDS: Record<ModerationCategory, { reject: number | null; review: number }> = {
  sexual: { reject: REJECT_THRESHOLD, review: REVIEW_THRESHOLD },
  // Sıfır tolerans: çok daha düşük eşik
  sexual_minors: { reject: 0.2, review: 0.05 },
  // Mayo, iç çamaşırı: araç tanıtımında görülebilir; kaldırmaz, insana gösterir
  suggestive: { reject: null, review: REJECT_THRESHOLD },
  violence: { reject: REJECT_THRESHOLD, review: REVIEW_THRESHOLD },
  gore: { reject: REJECT_THRESHOLD, review: REVIEW_THRESHOLD },
  weapon: { reject: REJECT_THRESHOLD, review: REVIEW_THRESHOLD },
  self_harm: { reject: null, review: REVIEW_THRESHOLD },
  harassment: { reject: REJECT_THRESHOLD, review: REVIEW_THRESHOLD },
  hate: { reject: REJECT_THRESHOLD, review: REVIEW_THRESHOLD },
  illegal: { reject: REJECT_THRESHOLD, review: REVIEW_THRESHOLD },
  profanity: { reject: REJECT_THRESHOLD, review: REVIEW_THRESHOLD },
};

const DECISION_RANK: Record<ModerationDecision, number> = { safe: 0, flagged: 1, rejected: 2 };

/** Olasılığı 0–1 aralığına çeker; sayı değilse 0 */
export function probability(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Tek bir denetimin puanlarından karar: eşik "büyüktür" ile karşılaştırılır (%60 tam sınır geçer) */
export function decide(scores: CategoryScores, provider: string): ModerationVerdict {
  const rejected: [ModerationCategory, number][] = [];
  const flagged: [ModerationCategory, number][] = [];
  for (const [category, raw] of Object.entries(scores) as [ModerationCategory, number][]) {
    const threshold = THRESHOLDS[category];
    if (!threshold) continue;
    const score = probability(raw);
    if (threshold.reject !== null && score > threshold.reject) rejected.push([category, score]);
    else if (score > threshold.review) flagged.push([category, score]);
  }
  const byScore = (list: [ModerationCategory, number][]) =>
    list.sort((a, b) => b[1] - a[1]).map(([category]) => category);

  if (rejected.length > 0) return { decision: "rejected", reasons: byScore(rejected), scores, provider };
  if (flagged.length > 0) return { decision: "flagged", reasons: byScore(flagged), scores, provider };
  return { decision: "safe", reasons: [], scores, provider };
}

/** Sağlayıcı yoksa ya da hata verdiyse: kapalı başarısızlık, insan incelemesi */
export function unavailableVerdict(provider: string, failure?: string): ModerationVerdict {
  const verdict: ModerationVerdict = { decision: "flagged", reasons: ["unavailable"], scores: {}, provider };
  if (failure) verdict.failures = [failure.slice(0, MAX_FAILURE_LENGTH)];
  return verdict;
}

/**
 * Birden fazla denetimin (kareler, fotoğraflar, metin) birleşik kararı: en kötü
 * karar geçerlidir; nedenler o karardaki denetimlerden, puanlar kategori başına
 * en yüksek değer.
 */
export function combineVerdicts(verdicts: readonly ModerationVerdict[]): ModerationVerdict {
  if (verdicts.length === 0) return { decision: "safe", reasons: [], scores: {}, provider: "none" };

  const decision = verdicts.reduce<ModerationDecision>(
    (worst, v) => (DECISION_RANK[v.decision] > DECISION_RANK[worst] ? v.decision : worst),
    "safe",
  );
  const reasons = [...new Set(verdicts.filter((v) => v.decision === decision).flatMap((v) => v.reasons))];
  const scores: CategoryScores = {};
  for (const verdict of verdicts) {
    for (const [category, score] of Object.entries(verdict.scores) as [ModerationCategory, number][]) {
      scores[category] = Math.max(scores[category] ?? 0, probability(score));
    }
  }
  const provider = [...new Set(verdicts.map((v) => v.provider))].join("+");
  const failures = [...new Set(verdicts.flatMap((v) => v.failures ?? []))].slice(0, MAX_FAILURES);
  return failures.length > 0 ? { decision, reasons, scores, provider, failures } : { decision, reasons, scores, provider };
}

/** Temel metin filtresinin (lib/text-moderation.ts) sonucu, puan olarak */
export function localTextScores(text: string | null | undefined): CategoryScores {
  const category = textModerationCategory(text);
  return category ? { [category]: 1 } : {};
}

// ---------------------------------------------------------------
// vehicles.moderation_reason
// ---------------------------------------------------------------

/**
 * Veritabanına yazılan neden. Ret: en güçlü neden ("sexual"). İnceleme:
 * "review:" + nedenler ("review:gore,unavailable"). Elle karar: "manual".
 */
export function moderationReasonCode(verdict: ModerationVerdict): string | null {
  if (verdict.decision === "safe") return null;
  if (verdict.decision === "rejected") return verdict.reasons[0] ?? "rejected";
  return `review:${verdict.reasons.join(",") || "unknown"}`;
}

export const MANUAL_REASON = "manual";
/**
 * Otomatik denetim temiz buldu, yönetici onayı bekleniyor (ilan 'pending_approval').
 * Yapay zekâ ilanı hiçbir zaman kendisi yayına almaz: video yalnızca örnek
 * karelerden taranır, kareler arasındaki sahne kaçabilir.
 */
export const AI_SAFE_REASON = "ai:safe";

/** moderation_reason → nedenler (yönetim paneli için) */
export function parseReasonCode(code: string | null): ModerationReason[] {
  if (!code || code === MANUAL_REASON || code === AI_SAFE_REASON) return [];
  const list = code.startsWith("review:") ? code.slice("review:".length).split(",") : [code];
  return list.filter(
    (reason): reason is ModerationReason => reason === "unavailable" || Object.hasOwn(THRESHOLDS, reason),
  );
}

export const REASON_LABELS: Record<ModerationReason, string> = {
  sexual: "Cinsel içerik / çıplaklık",
  sexual_minors: "Reşit olmayanlarla ilgili cinsel içerik",
  suggestive: "Müstehcen görünüm",
  violence: "Şiddet",
  gore: "Kan / yaralanma",
  weapon: "Silah",
  self_harm: "Kendine zarar",
  harassment: "Taciz / tehdit",
  hate: "Nefret söylemi",
  illegal: "Yasa dışı içerik",
  profanity: "Küfür / hakaret",
  unavailable: "Otomatik denetim yapılamadı",
};

// ---------------------------------------------------------------
// Video kareleri (Cloudflare Stream kapak adresi)
// ---------------------------------------------------------------

/** Kapağa ek olarak videonun eşit aralıklarından alınan kare sayısı */
export const VIDEO_SAMPLE_FRAMES = 5;
/** Denetlenen karelerin yüksekliği: sınıflandırma için yeterli, indirmesi hızlı */
export const FRAME_HEIGHT = 480;
/**
 * Kapak (akıştaki poster) videonun bu oranındaki kare. Yüklemede Cloudflare'e
 * thumbnailTimestampPct olarak verilir (lib/cloudflare.ts); kapak denetimi aynı
 * kareyi zamanıyla ister.
 */
export const THUMBNAIL_TIMESTAMP_PCT = 0.2;

/**
 * Kare zamanları (tam saniye): süre N eşit parçaya bölünür, her parçanın
 * ortasından bir kare. Süre bilinmiyorsa kısa videoda da var olan ilk saniyeler.
 */
export function videoFrameTimes(durationSeconds: number | null, count: number = VIDEO_SAMPLE_FRAMES): number[] {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return [1, 3, 6].slice(0, count);
  const times = Array.from({ length: count }, (_, i) => Math.floor(((i + 0.5) * durationSeconds) / count));
  return [...new Set(times)];
}

/**
 * Cloudflare Stream kapak adresinden belirli bir saniyenin karesi:
 * https://customer-<kod>.cloudflarestream.com/<uid>/thumbnails/thumbnail.jpg?time=12s&height=480
 */
export function videoFrameUrl(thumbnailUrl: string, seconds: number, height: number = FRAME_HEIGHT): string {
  const url = new URL(thumbnailUrl);
  url.searchParams.set("time", `${Math.max(0, Math.floor(seconds))}s`);
  url.searchParams.set("height", String(height));
  return url.toString();
}

/**
 * Kapak karesi, zamanıyla: …/thumbnail.jpg?time=5.6s&height=480.
 *
 * Zamansız kapak adresi (thumbnail.jpg, thumbnailTimestampPct'ye göre) Cloudflare
 * "ready" webhook'unu gönderdikten sonra ~30 sn daha 404 veriyor (27 Eylül 2026,
 * üç test videosunda ölçüldü: ready + 40–43 sn'de 200). Denetim webhook'un hemen
 * ardından çalıştığı için kapak indirilemiyor, ilan "Otomatik denetim yapılamadı"
 * (review:unavailable) ile kuyruğa düşüyordu. Zamanlı kareler ready anında hazır.
 * Süre bilinmiyorsa zamansız adrese düşülür.
 */
export function coverFrameUrl(thumbnailUrl: string, durationSeconds: number | null, height: number = FRAME_HEIGHT): string {
  const url = new URL(thumbnailUrl);
  url.searchParams.delete("time");
  if (durationSeconds && Number.isFinite(durationSeconds) && durationSeconds > 0) {
    // Tek ondalık (Cloudflare kesirli saniyeyi kabul ediyor: time=0.4s)
    url.searchParams.set("time", `${Number((durationSeconds * THUMBNAIL_TIMESTAMP_PCT).toFixed(1))}s`);
  }
  url.searchParams.set("height", String(height));
  return url.toString();
}

/** Denetlenecek bir video karesi; label denetlenemezse kayda yazılır ("kapak", "kare 8 sn") */
export type VideoFrame = { url: string; label: string };

/** Bir videonun denetlenecek kareleri: kapak (akışta görünen) + örnek kareler */
export function videoModerationTargets(thumbnailUrl: string, durationSeconds: number | null): VideoFrame[] {
  const frames: VideoFrame[] = [
    { url: coverFrameUrl(thumbnailUrl, durationSeconds), label: "kapak" },
    ...videoFrameTimes(durationSeconds).map((t) => ({ url: videoFrameUrl(thumbnailUrl, t), label: `kare ${t} sn` })),
  ];
  const seen = new Set<string>();
  return frames.filter((frame) => !seen.has(frame.url) && seen.add(frame.url));
}

export function videoModerationFrames(thumbnailUrl: string, durationSeconds: number | null): string[] {
  return videoModerationTargets(thumbnailUrl, durationSeconds).map((frame) => frame.url);
}

// ---------------------------------------------------------------
// Kullanıcıya gösterilen metinler
// ---------------------------------------------------------------

export const LISTING_REJECTED_MESSAGE = "Yüklenen içerik topluluk kurallarına uymadığı için yayınlanmadı.";
export const LISTING_IN_REVIEW_MESSAGE =
  "İlanın içerik denetiminde. Denetimden ve yönetici onayından sonra yayına alınacak.";
export const LISTING_AWAITING_APPROVAL_MESSAGE =
  "İlanınız onay bekliyor, yönetici incelemesinden sonra yayına alınacaktır.";
export const AVATAR_REJECTED_MESSAGE =
  "Bu fotoğraf topluluk kurallarına uymadığı için kullanılamaz. Başka bir fotoğraf seç.";
export const AVATAR_UNAVAILABLE_MESSAGE = "Fotoğraf şu an denetlenemiyor. Biraz sonra tekrar dene.";
