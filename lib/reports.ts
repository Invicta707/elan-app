import { isUuid } from "./feed";

// İlan bildirimi: nedenler, istek doğrulaması ve /api/reports çağrısı.
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

/** İstek gövdesini doğrular; açıklama kırpılır, boşsa null olur. */
export function parseReportInput(body: unknown): ParseResult {
  const { vehicleId, reason, details } = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(vehicleId)) {
    return { ok: false, code: "invalid_vehicle", message: "Bildirilecek ilan bulunamadı." };
  }
  if (!isReportReason(reason)) {
    return { ok: false, code: "invalid_reason", message: "Bir bildirim nedeni seç." };
  }

  const text = typeof details === "string" ? details.trim() : "";
  if (text.length > MAX_REPORT_DETAILS) {
    return {
      ok: false,
      code: "details_too_long",
      message: `Açıklama en fazla ${MAX_REPORT_DETAILS} karakter olabilir.`,
    };
  }

  return { ok: true, value: { vehicleId, reason, details: text || null } };
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
