import { isUuid } from "./feed";
import { toMyListing, type MyListing, type MyListingRow } from "./my-listings";
import type { ReportReason } from "./reports";

// Moderasyon paneli (/admin/reports): ortak türler, istek doğrulaması, bildirim
// kuyruğunun gruplanması ve /api/admin/reports çağrıları. UI'dan bağımsız.
// Yetki denetimi ve veritabanı işlemleri: lib/moderation-server.ts.

/**
 * ADMIN_EMAILS: virgülle ayrılmış yönetici e-postaları. Boşluk ve büyük/küçük
 * harf önemsiz; boş liste kimseye yetki vermez.
 */
export function parseAdminEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

// ---------------------------------------------------------------
// Kuyruk: açık bildirimler, ilan başına gruplu
// ---------------------------------------------------------------

export type ModerationReport = {
  id: string;
  reason: ReportReason;
  details: string | null;
  createdAt: string;
};

export type ModerationItem = {
  vehicle: MyListing;
  /** En eskisi önce */
  reports: ModerationReport[];
};

export type OpenReportRow = {
  id: string;
  reason: ReportReason;
  details: string | null;
  created_at: string;
  vehicle: MyListingRow | null;
};

/**
 * Bildirim satırlarını ilan başına toplar. Satırlar en eskiden yeniye gelir;
 * kuyruk, en eski açık bildirimi olan ilandan başlar.
 */
export function toModerationQueue(rows: OpenReportRow[]): ModerationItem[] {
  const byVehicle = new Map<string, ModerationItem>();
  for (const row of rows) {
    if (!row.vehicle) continue;
    let item = byVehicle.get(row.vehicle.id);
    if (!item) {
      item = { vehicle: toMyListing(row.vehicle), reports: [] };
      byVehicle.set(row.vehicle.id, item);
    }
    item.reports.push({ id: row.id, reason: row.reason, details: row.details, createdAt: row.created_at });
  }
  return [...byVehicle.values()];
}

// ---------------------------------------------------------------
// Aksiyonlar
// ---------------------------------------------------------------

/**
 * remove_listing: ilan 'rejected' olur, ilanın tüm açık bildirimleri 'reviewed'.
 * dismiss: yalnızca verilen (moderatörün gördüğü) bildirimler 'dismissed'; ilana dokunulmaz.
 */
export type ModerationAction =
  | { action: "remove_listing"; vehicleId: string }
  | { action: "dismiss"; reportIds: string[] };

export const MAX_DISMISS_REPORTS = 100;

export type ParseActionResult =
  | { ok: true; value: ModerationAction }
  | { ok: false; code: "invalid_action" | "invalid_vehicle" | "invalid_reports"; message: string };

export function parseModerationAction(body: unknown): ParseActionResult {
  const { action, vehicleId, reportIds } = (body ?? {}) as Record<string, unknown>;

  if (action === "remove_listing") {
    if (!isUuid(vehicleId)) {
      return { ok: false, code: "invalid_vehicle", message: "Kaldırılacak ilan bulunamadı." };
    }
    return { ok: true, value: { action, vehicleId } };
  }

  if (action === "dismiss") {
    if (
      !Array.isArray(reportIds) ||
      reportIds.length === 0 ||
      reportIds.length > MAX_DISMISS_REPORTS ||
      !reportIds.every(isUuid)
    ) {
      return { ok: false, code: "invalid_reports", message: "Kapatılacak bildirimler geçersiz." };
    }
    return { ok: true, value: { action, reportIds: [...new Set(reportIds as string[])] } };
  }

  return { ok: false, code: "invalid_action", message: "Bilinmeyen moderasyon işlemi." };
}

// ---------------------------------------------------------------
// Tarayıcıdan /api/admin/reports çağrıları
// ---------------------------------------------------------------

/** status: HTTP durumu; ağ hatasında 0. 401/403 panelden çıkarılmayı gerektirir. */
export type ModerationFailure = { ok: false; status: number; message: string };

const NETWORK_ERROR = "Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.";
const GENERIC_ERROR = "İşlem tamamlanamadı. Biraz sonra tekrar dene.";

async function callModerationApi<T>(
  payload: ModerationAction | null,
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; body: T } | ModerationFailure> {
  let response: Response;
  try {
    response = await fetchImpl("/api/admin/reports", {
      method: payload ? "POST" : "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
  } catch {
    return { ok: false, status: 0, message: NETWORK_ERROR };
  }

  const body = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (response.ok && body) return { ok: true, body };
  return { ok: false, status: response.status, message: body?.error?.message ?? GENERIC_ERROR };
}

export async function fetchModerationQueue(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; items: ModerationItem[] } | ModerationFailure> {
  const result = await callModerationApi<{ items: ModerationItem[] }>(null, accessToken, fetchImpl);
  return result.ok ? { ok: true, items: result.body.items } : result;
}

export async function submitModerationAction(
  input: ModerationAction,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; resolved: number } | ModerationFailure> {
  const result = await callModerationApi<{ resolved: number }>(input, accessToken, fetchImpl);
  return result.ok ? { ok: true, resolved: result.body.resolved } : result;
}
