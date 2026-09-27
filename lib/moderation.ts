import {
  AI_SAFE_REASON,
  parseReasonCode,
  videoModerationFrames,
  type ModerationDecision,
  type ModerationReason,
} from "./content-moderation";
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
  payload: object | null,
  accessToken: string,
  fetchImpl: typeof fetch,
  path: "/api/admin/reports" | "/api/admin/listings" = "/api/admin/reports",
): Promise<{ ok: true; body: T } | ModerationFailure> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
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

// ---------------------------------------------------------------
// İçerik denetimi kuyruğu (/api/admin/listings)
// ---------------------------------------------------------------
//
// Yayına yalnızca yönetici alır. Kuyrukta: otomatik denetimi temiz bulunup onay
// bekleyen ('pending_approval'), şüpheli (%40–60) ya da denetlenemeyen
// (sağlayıcı yok / hata) ve denetimi yarıda kalan ('pending_moderation')
// ilanlar. Hepsi akışta görünmez; burada bir insan karar verir.

export type PendingListing = {
  vehicle: MyListing;
  description: string | null;
  /** Otomatik denetimin şüphe nedenleri (kategori ya da "unavailable") */
  reasons: ModerationReason[];
  /** Otomatik denetim bitti. false: denetim sürüyor ya da yarıda kaldı */
  needsReview: boolean;
  /** Otomatik denetim temiz buldu; yalnızca yönetici onayı bekleniyor */
  aiClean: boolean;
  /** İnceleme için video kareleri (kapak + ara kareler) ve fotoğraflar */
  media: string[];
  /**
   * Videonun tamamı (Cloudflare Stream izleme sayfası). Otomatik denetim yalnızca
   * örnek karelere bakar; yönetici onaylamadan önce videoyu baştan sona izlemeli.
   */
  watchUrl: string | null;
};

/**
 * Cloudflare Stream HLS adresinden izleme sayfası:
 * https://customer-<kod>.cloudflarestream.com/<uid>/manifest/video.m3u8 → …/<uid>/watch
 */
export function streamWatchUrl(hlsUrl: string | null): string | null {
  if (!hlsUrl) return null;
  try {
    const url = new URL(hlsUrl);
    const match = /^\/([0-9a-f]{32})\/manifest\/video\.m3u8$/i.exec(url.pathname);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".cloudflarestream.com") || !match) return null;
    return `${url.origin}/${match[1]}/watch`;
  } catch {
    return null;
  }
}

export type PendingListingRow = Omit<MyListingRow, "videos"> & {
  description: string | null;
  moderation_reason: string | null;
  videos:
    | { status: string; hls_url: string | null; thumbnail_url: string | null; duration_seconds?: number | null }[]
    | null;
};

export function toPendingListing(row: PendingListingRow): PendingListing {
  const readyVideos = (row.videos ?? []).filter((video) => video.status === "ready" && video.hls_url);
  const frames = readyVideos
    .filter((video) => video.thumbnail_url)
    .flatMap((video) => videoModerationFrames(video.thumbnail_url as string, video.duration_seconds ?? null));
  const photos = [...(row.images ?? [])]
    .sort((a, b) => a.display_order - b.display_order)
    .flatMap((image) => (image.image_url ? [image.image_url] : []));
  return {
    vehicle: toMyListing(row),
    description: row.description,
    reasons: parseReasonCode(row.moderation_reason),
    needsReview: row.moderation_reason !== null,
    aiClean: row.moderation_reason === AI_SAFE_REASON,
    media: [...frames, ...photos],
    watchUrl: streamWatchUrl(readyVideos[0]?.hls_url ?? null),
  };
}

/** approve: yayına al; reject: reddet ve medyayı sil; recheck: otomatik denetimi yeniden çalıştır */
export type ListingDecision = { action: "approve" | "reject" | "recheck"; vehicleId: string };

export type ParseDecisionResult =
  | { ok: true; value: ListingDecision }
  | { ok: false; code: "invalid_action" | "invalid_vehicle"; message: string };

export function parseListingDecision(body: unknown): ParseDecisionResult {
  const { action, vehicleId } = (body ?? {}) as Record<string, unknown>;
  if (action !== "approve" && action !== "reject" && action !== "recheck") {
    return { ok: false, code: "invalid_action", message: "Bilinmeyen moderasyon işlemi." };
  }
  if (!isUuid(vehicleId)) return { ok: false, code: "invalid_vehicle", message: "İlan bulunamadı." };
  return { ok: true, value: { action, vehicleId } };
}

export async function fetchPendingListings(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; items: PendingListing[] } | ModerationFailure> {
  const result = await callModerationApi<{ items: PendingListing[] }>(null, accessToken, fetchImpl, "/api/admin/listings");
  return result.ok ? { ok: true, items: result.body.items } : result;
}

export async function submitListingDecision(
  input: ListingDecision,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; decision: ModerationDecision | null; published: boolean } | ModerationFailure> {
  const result = await callModerationApi<{ decision?: ModerationDecision | null; published?: boolean }>(
    input,
    accessToken,
    fetchImpl,
    "/api/admin/listings",
  );
  return result.ok
    ? { ok: true, decision: result.body.decision ?? null, published: Boolean(result.body.published) }
    : result;
}
