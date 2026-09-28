import { isUuid } from "./feed";

// İlan ve yorum bildirimi: nedenler, istek doğrulaması ve /api/reports çağrısı.
// UI'dan bağımsız: sunucu (app/api/reports) ve istemci aynı kuralları kullanır.

/** Veritabanındaki CHECK kısıtıyla aynı (supabase/migrations/*_reports.sql) */
export const REPORT_REASONS = {
  fraud: "Dolandırıcılık veya sahte ilan",
  wrong_info: "Yanlış ya da yanıltıcı bilgi",
  inappropriate: "Uygunsuz içerik (şiddet, müstehcenlik, nefret söylemi)",
  spam: "Spam veya tekrarlanan ilan",
  sold: "Araç satılmış, ilan güncel değil",
  other: "Diğer",
} as const;

export type ReportReason = keyof typeof REPORT_REASONS;

export const MAX_REPORT_DETAILS = 500;

/**
 * /api/reports kalıcı istek sınırı (veritabanı sayacı; bkz. lib/rate-limit-server.ts).
 * Giriş yapmış kullanıcı kendi hesabına göre sayılır. IP sınırı, aynı IP'yi
 * paylaşan mobil kullanıcılar (CGNAT) birbirini engellemesin diye gevşektir.
 */
export const REPORT_RATE_RULES = {
  anonymous: [
    { scope: "ip", limit: 5, windowSeconds: 60 },
    { scope: "ip", limit: 20, windowSeconds: 60 * 60 },
  ],
  authenticated: [
    { scope: "user", limit: 5, windowSeconds: 60 },
    { scope: "user", limit: 30, windowSeconds: 24 * 60 * 60 },
    { scope: "ip", limit: 30, windowSeconds: 60 },
  ],
} as const satisfies Record<string, readonly { scope: "ip" | "user"; limit: number; windowSeconds: number }[]>;

/**
 * Bellek içi ön sınır (sunucu örneği başına): ani seriyi veritabanına ve oturum
 * doğrulamaya gitmeden keser. Kalıcı kuralların en gevşek IP sınırına eşit.
 */
export const REPORT_BURST_LIMIT = { limit: 30, windowMs: 60_000 } as const;

export type ReportInput = {
  vehicleId: string;
  reason: ReportReason;
  details: string | null;
};

export type ParseResult =
  | { ok: true; value: ReportInput }
  | { ok: false; code: "invalid_vehicle" | "invalid_reason" | "details_too_long"; message: string };

function isReportReason(value: unknown): value is ReportReason {
  return typeof value === "string" && Object.hasOwn(REPORT_REASONS, value);
}

const DETAILS_TOO_LONG = {
  ok: false,
  code: "details_too_long",
  message: `Açıklama en fazla ${MAX_REPORT_DETAILS} karakter olabilir.`,
} as const;

/** Açıklama kırpılır, boşsa null; sınırı aşarsa undefined */
function parseDetails(details: unknown): string | null | undefined {
  const text = typeof details === "string" ? details.trim() : "";
  if (text.length > MAX_REPORT_DETAILS) return undefined;
  return text || null;
}

/** İstek gövdesini doğrular; açıklama kırpılır, boşsa null olur. */
export function parseReportInput(body: unknown): ParseResult {
  const { vehicleId, reason, details } = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(vehicleId)) {
    return { ok: false, code: "invalid_vehicle", message: "Bildirilecek ilan bulunamadı." };
  }
  if (!isReportReason(reason)) {
    return { ok: false, code: "invalid_reason", message: "Bir bildirim nedeni seç." };
  }

  const text = parseDetails(details);
  if (text === undefined) return DETAILS_TOO_LONG;

  return { ok: true, value: { vehicleId, reason, details: text } };
}

// ---------------------------------------------------------------
// Yorum şikayeti (Google Play kullanıcı içeriği politikası)
// ---------------------------------------------------------------
//
// Aynı uç (/api/reports) ve aynı tablo (reports.comment_id dolu): gövdede
// commentId varsa yorum şikayetidir. İlan, yorumdan sunucuda okunur.

/** Veritabanındaki CHECK kısıtıyla aynı (supabase/migrations/*_comment_reports.sql) */
export const COMMENT_REPORT_REASONS = {
  harassment: "Taciz, hakaret ya da tehdit",
  hate: "Nefret söylemi ya da ayrımcılık",
  sexual: "Müstehcen ya da cinsel içerik",
  spam: "Spam, reklam ya da alakasız içerik",
  fraud: "Dolandırıcılık girişimi",
  other: "Diğer",
} as const;

export type CommentReportReason = keyof typeof COMMENT_REPORT_REASONS;

export type CommentReportInput = {
  commentId: string;
  reason: CommentReportReason;
  details: string | null;
};

export type ParseCommentReportResult =
  | { ok: true; value: CommentReportInput }
  | { ok: false; code: "invalid_comment" | "invalid_reason" | "details_too_long"; message: string };

/** Gövdede commentId alanı varsa istek bir yorum şikayetidir */
export function isCommentReportBody(body: unknown): boolean {
  return typeof body === "object" && body !== null && Object.hasOwn(body, "commentId");
}

function isCommentReportReason(value: unknown): value is CommentReportReason {
  return typeof value === "string" && Object.hasOwn(COMMENT_REPORT_REASONS, value);
}

/** Yorum şikayeti gövdesini doğrular; açıklama kırpılır, boşsa null olur. */
export function parseCommentReportInput(body: unknown): ParseCommentReportResult {
  const { commentId, reason, details } = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(commentId)) {
    return { ok: false, code: "invalid_comment", message: "Şikayet edilecek yorum bulunamadı." };
  }
  if (!isCommentReportReason(reason)) {
    return { ok: false, code: "invalid_reason", message: "Bir şikayet nedeni seç." };
  }

  const text = parseDetails(details);
  if (text === undefined) return DETAILS_TOO_LONG;

  return { ok: true, value: { commentId, reason, details: text } };
}

/** "already": giriş yapmış kullanıcı bu ilanı daha önce bildirmiş */
export type SubmitReportResult = { ok: true; already: boolean } | { ok: false; message: string };

/**
 * Bildirimi gönderir. Giriş yapılmışsa oturum anahtarı eklenir: aynı kişinin
 * aynı ilanı tekrar tekrar bildirmesi engellenir. Giriş yapmadan da bildirilebilir.
 */
export async function submitReport(
  input: ReportInput,
  accessToken: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitReportResult> {
  return postReport(input, accessToken, fetchImpl);
}

/**
 * Yorum şikayetini gönderir: ilan bildirimiyle aynı kurallar (oturum varsa
 * aynı yorumun tekrarı sayılmaz, giriş yapmadan da gönderilebilir).
 */
export async function submitCommentReport(
  input: CommentReportInput,
  accessToken: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitReportResult> {
  return postReport(input, accessToken, fetchImpl);
}

async function postReport(
  input: ReportInput | CommentReportInput,
  accessToken: string | null,
  fetchImpl: typeof fetch,
): Promise<SubmitReportResult> {
  let response: Response;
  try {
    response = await fetchImpl("/api/reports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, message: "Bildirim gönderilemedi. Bağlantını kontrol edip tekrar dene." };
  }

  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; alreadyReported?: boolean; error?: { message?: string } }
    | null;

  if (response.ok && body?.ok) return { ok: true, already: Boolean(body.alreadyReported) };
  return {
    ok: false,
    message: body?.error?.message ?? "Bildirim gönderilemedi. Biraz sonra tekrar dene.",
  };
}
