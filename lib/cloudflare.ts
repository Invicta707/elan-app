import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Cloudflare Stream ile konuşan sunucu tarafı yardımcılar.
// "server-only": bu dosya yanlışlıkla bir istemci bileşenine import edilirse
// build hata verir; API anahtarı tarayıcı paketine sızamaz.

// ---------------------------------------------------------------
// Yükleme sınırları
// ---------------------------------------------------------------

/** Cloudflare bu süreyi aşan videoyu ERR_DURATION_EXCEED_CONSTRAINT ile reddeder. */
export const MAX_VIDEO_DURATION_SECONDS = 60;

/**
 * tus yüklemede dosya boyutu (Upload-Length) bağlantı oluşturulurken sabitlenir;
 * Cloudflare beyan edilenden fazlasını kabul etmez. 60 sn'lik 4K telefon videosu
 * (HEVC) ~400 MB'a kadar çıkabildiği için 500 MB.
 */
export const MAX_VIDEO_FILE_BYTES = 500 * 1024 * 1024;

/** Tek kullanımlık yükleme bağlantısının geçerlilik süresi. */
export const UPLOAD_URL_TTL_MINUTES = 30;

/** Kapak görseli videonun %20'sinden alınır (ilk kare çoğu zaman siyah/bulanık). */
const THUMBNAIL_TIMESTAMP_PCT = 0.2;

/** Bundan eski imza zaman damgası reddedilir (tekrar gönderim / replay koruması). */
const WEBHOOK_TOLERANCE_SECONDS = 300;

const API_BASE = "https://api.cloudflare.com/client/v4";

// ---------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------

export class CloudflareStreamError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CloudflareStreamError";
    this.status = status;
  }
}

export type DirectUploadRequest = {
  /** Dosyanın byte cinsinden boyutu (tarayıcıda file.size). */
  fileSize: number;
  /** Supabase kullanıcı id'si; Cloudflare'de videonun "creator" alanına yazılır. */
  creatorId: string;
  /** Takip için videonun meta'sına yazılır (Cloudflare panelinde görünür). */
  vehicleId: string;
  /** Panelde görünen ad; verilmezse ilan id'si kullanılır. */
  fileName?: string;
  /** Varsayılan ve üst sınır: MAX_VIDEO_DURATION_SECONDS */
  maxDurationSeconds?: number;
};

export type DirectUpload = {
  /** tus istemcisinin (tus-js-client: uploadUrl) dosyayı yükleyeceği tek kullanımlık adres */
  uploadUrl: string;
  /** Cloudflare video uid'si; videos.stream_uid */
  streamUid: string;
  /** Bu zamandan sonra bağlantı yükleme kabul etmez (ISO 8601, UTC) */
  expiresAt: string;
  maxDurationSeconds: number;
};

/** Cloudflare Stream webhook gövdesinde kullandığımız alanlar */
export type StreamWebhookPayload = {
  uid?: string;
  readyToStream?: boolean;
  status?: {
    state?: string;
    pctComplete?: string;
    // Cloudflare dokümanında iki yazım da geçiyor
    errorReasonCode?: string;
    errorReasonText?: string;
    errReasonCode?: string;
    errReasonText?: string;
  };
  thumbnail?: string;
  duration?: number;
  playback?: { hls?: string; dash?: string };
  meta?: Record<string, unknown>;
  creator?: string | null;
};

// ---------------------------------------------------------------
// Doğrudan yükleme (Direct Creator Upload, tus protokolü)
// ---------------------------------------------------------------

function getStreamConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error(
      "Cloudflare ortam değişkenleri eksik: CLOUDFLARE_ACCOUNT_ID ve CLOUDFLARE_API_TOKEN .env.local'de tanımlı olmalı.",
    );
  }
  return { accountId, apiToken };
}

/** tus Upload-Metadata: "anahtar base64(değer)" çiftleri, aralarında boşluksuz virgül */
function toTusMetadata(values: Record<string, string | undefined>): string {
  return Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => `${key} ${Buffer.from(value, "utf8").toString("base64")}`)
    .join(",");
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { errors?: { code?: number; message?: string }[] };
    const first = body.errors?.[0];
    if (first?.message) {
      return `Cloudflare ${response.status}: ${first.message}${first.code ? ` (${first.code})` : ""}`;
    }
  } catch {
    // Gövde JSON değil; aşağıda düz metin olarak döner
  }
  return `Cloudflare ${response.status}: ${text.slice(0, 200) || response.statusText}`;
}

/**
 * Tarayıcının videoyu API anahtarı görmeden doğrudan Cloudflare'e yükleyeceği
 * tek kullanımlık tus bağlantısını üretir.
 *
 * Neden basic POST değil de tus: basic POST'ta dosya boyutu sınırlanamaz (200 MB
 * platform sınırı dışında) ve kesilen yükleme baştan başlar. tus'ta boyut bağlantı
 * oluşturulurken sabitlenir ve mobil bağlantıda yükleme kaldığı yerden devam eder.
 */
export async function getDirectUploadUrl(request: DirectUploadRequest): Promise<DirectUpload> {
  const { accountId, apiToken } = getStreamConfig();

  if (
    !Number.isInteger(request.fileSize) ||
    request.fileSize <= 0 ||
    request.fileSize > MAX_VIDEO_FILE_BYTES
  ) {
    throw new RangeError(`Dosya boyutu 1 ile ${MAX_VIDEO_FILE_BYTES} byte arasında olmalı.`);
  }

  const maxDurationSeconds = Math.max(
    1,
    Math.min(request.maxDurationSeconds ?? MAX_VIDEO_DURATION_SECONDS, MAX_VIDEO_DURATION_SECONDS),
  );

  // RFC 3339, milisaniyesiz: 2026-09-24T10:30:00Z
  const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_MINUTES * 60_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");

  const response = await fetch(`${API_BASE}/accounts/${accountId}/stream?direct_user=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(request.fileSize),
      "Upload-Creator": request.creatorId,
      "Upload-Metadata": toTusMetadata({
        maxDurationSeconds: String(maxDurationSeconds),
        expiry: expiresAt,
        thumbnailtimestamppct: String(THUMBNAIL_TIMESTAMP_PCT),
        name: request.fileName?.trim().slice(0, 100) || `ilan-${request.vehicleId}`,
        // Standart dışı anahtarlar videonun meta alanına yazılır
        vehicleid: request.vehicleId,
      }),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new CloudflareStreamError(await readErrorMessage(response), response.status);
  }

  // tus: bağlantı gövdede değil başlıklarda döner
  const uploadUrl = response.headers.get("location");
  const streamUid = response.headers.get("stream-media-id");
  if (!uploadUrl || !streamUid) {
    throw new CloudflareStreamError(
      "Cloudflare yanıtında Location ya da stream-media-id başlığı yok.",
      502,
    );
  }

  return { uploadUrl, streamUid, expiresAt, maxDurationSeconds };
}

/** Videoyu Cloudflare'den siler (kayıt açılamadığında yetim video kalmasın diye). */
export async function deleteStreamVideo(streamUid: string): Promise<void> {
  const { accountId, apiToken } = getStreamConfig();
  const response = await fetch(
    `${API_BASE}/accounts/${accountId}/stream/${encodeURIComponent(streamUid)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiToken}` },
      cache: "no-store",
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new CloudflareStreamError(await readErrorMessage(response), response.status);
  }
}

// ---------------------------------------------------------------
// Webhook imza doğrulaması
// ---------------------------------------------------------------

/**
 * "Webhook-Signature: time=1230811200,sig1=<hex>" başlığını doğrular.
 * İmza = HMAC-SHA256(secret, `${time}.${ham gövde}`). Gövde byte'ı byte'ına
 * alınmalı (request.arrayBuffer); JSON'a çevrilip geri yazılan gövde uyuşmaz.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | null,
  secret: string,
  nowSeconds: number = Date.now() / 1000,
): boolean {
  if (!signatureHeader || !secret) return false;

  const parts = new Map<string, string>();
  for (const piece of signatureHeader.split(",")) {
    const separator = piece.indexOf("=");
    if (separator > 0)
      parts.set(piece.slice(0, separator).trim(), piece.slice(separator + 1).trim());
  }

  const time = parts.get("time");
  const signature = parts.get("sig1");
  if (!time || !/^\d+$/.test(time) || !signature || !/^[0-9a-f]{64}$/i.test(signature)) {
    return false;
  }
  if (Math.abs(nowSeconds - Number(time)) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${time}.`, "utf8"), rawBody]))
    .digest();
  const received = Buffer.from(signature, "hex");

  // Sabit zamanlı karşılaştırma: imzanın ne kadarının tuttuğu süreden anlaşılamaz
  return received.length === expected.length && timingSafeEqual(received, expected);
}