import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteStreamVideo } from "./cloudflare";
import {
  MANUAL_REASON,
  combineVerdicts,
  moderationReasonCode,
  unavailableVerdict,
  videoModerationFrames,
  type ModerationDecision,
  type ModerationVerdict,
} from "./content-moderation";
import { moderateImages, moderateText, recordModerationEvent, type ModerationEvent } from "./content-moderation-server";
import { PHOTO_BUCKET } from "./listing";
import type { ModerationStatus, VehicleStatus } from "./listing-status";
import { moderationProvidersFromEnv, type ImageInput, type ModerationProviders } from "./moderation-providers";
import { getSupabaseAdmin } from "./supabase-server";

// İlanın otomatik içerik denetimi (karantina hattı).
//
//   1) Video Cloudflare'de işlenir; webhook ilanı 'pending_moderation'a alır
//      (lib/video-activation.ts). Bu andan sonra satıcı açıklamayı ve
//      fotoğrafları değiştiremez (bkz. *_content_moderation.sql).
//   2) moderateListing: açıklama (temel filtre + OpenAI), fotoğraflar ve video
//      kareleri (kapak + 5 ara kare) denetlenir.
//   3) Karar:
//        safe     → denetim 'approved', ilan 'active' (akışa girer)
//        flagged  → ilan beklemede; /admin/reports'ta insan karar verir
//        rejected → ilan ve denetim 'rejected'; Cloudflare videoları, Storage
//                   fotoğrafları ve kayıtları silinir; Vitrinim'de uyarı çıkar
//   4) Her karar content_moderation_events'e yazılır.
//
// Veritabanı işlemleri ListingModerationStore arkasında: karar mantığı
// lib/listing-moderation.test.ts'te sahte bir depoyla sınanır.

export type ListingSnapshot = {
  id: string;
  sellerId: string;
  status: VehicleStatus;
  moderationStatus: ModerationStatus;
  moderationReason: string | null;
  description: string | null;
  city: string | null;
  photoUrls: string[];
  /** İşlenmiş videolar: kareleri bunlardan alınır */
  readyVideos: { thumbnailUrl: string | null; durationSeconds: number | null }[];
  /** Bütün videoların Cloudflare uid'leri (ret temizliği için) */
  streamUids: string[];
};

export interface ListingModerationStore {
  load(vehicleId: string): Promise<ListingSnapshot | null>;
  /** Denetim 'approved'; ilan 'pending_moderation'daysa aynı güncellemede 'active'. */
  approve(vehicleId: string, reason: string | null): Promise<{ published: boolean }>;
  /** Karar insana kalır: ilan beklemede, neden yazılır */
  hold(vehicleId: string, reason: string): Promise<void>;
  /** İlan ve denetim 'rejected' */
  reject(vehicleId: string, reason: string): Promise<void>;
  /** Cloudflare videoları, Storage fotoğrafları ve video/fotoğraf kayıtları */
  purgeMedia(listing: ListingSnapshot): Promise<void>;
  record(event: ModerationEvent): Promise<void>;
}

// ---------------------------------------------------------------
// Denetim
// ---------------------------------------------------------------

/** İlanın bütün içeriği: metin, video kareleri (önce: kural dışı içerik en çok videoda) ve fotoğraflar */
export async function evaluateListing(
  listing: ListingSnapshot,
  providers: ModerationProviders,
): Promise<ModerationVerdict> {
  const text = [listing.description, listing.city].filter(Boolean).join("\n");
  const textVerdict = await moderateText(providers.text, text, { onProviderError: "flag" });
  // Metin açıkça kural dışıysa görseller için sağlayıcı kotası harcanmaz
  if (textVerdict.decision === "rejected") return textVerdict;

  const verdicts = [textVerdict];
  const images: ImageInput[] = [];
  for (const video of listing.readyVideos) {
    if (video.thumbnailUrl) images.push(...videoModerationFrames(video.thumbnailUrl, video.durationSeconds).map((url) => ({ url })));
    // Karesi alınamayan video denetlenmemiş sayılır
    else verdicts.push(unavailableVerdict("cloudflare"));
  }
  images.push(...listing.photoUrls.map((url) => ({ url })));
  verdicts.push(await moderateImages(providers.image, images));
  return combineVerdicts(verdicts);
}

export type ListingModerationResult =
  | { status: "skipped"; reason: "not_found" | "already_decided" }
  | { status: "decided"; decision: ModerationDecision; reasons: ModerationVerdict["reasons"]; published: boolean };

/** Karar denetimden ya da yönetim panelinden gelir; uygulanışı aynı */
async function applyDecision(
  store: ListingModerationStore,
  listing: ListingSnapshot,
  decision: ModerationDecision,
  reason: string | null,
): Promise<{ published: boolean }> {
  if (decision === "safe") return store.approve(listing.id, reason);
  if (decision === "flagged") {
    await store.hold(listing.id, reason ?? "review:unknown");
    return { published: false };
  }
  await store.reject(listing.id, reason ?? "rejected");
  // İlan artık görünmüyor; temizlik yarım kalırsa kararı geri almaz, loglanır
  await store.purgeMedia(listing).catch((error) =>
    console.error("İçerik denetimi: reddedilen ilanın medyası silinemedi:", listing.id, error),
  );
  return { published: false };
}

/**
 * Denetimi bekleyen (moderation_status 'pending') ilanı denetler ve kararı
 * uygular. Karar verilmiş ilana dokunmaz; aynı ilan için iki kez çağrılsa da
 * ikinci çağrı "already_decided" döner (webhook tekrarları).
 */
export async function moderateListing(
  vehicleId: string,
  { store, providers }: { store: ListingModerationStore; providers: ModerationProviders },
): Promise<ListingModerationResult> {
  const listing = await store.load(vehicleId);
  if (!listing) return { status: "skipped", reason: "not_found" };
  if (listing.moderationStatus !== "pending") return { status: "skipped", reason: "already_decided" };

  const verdict = await evaluateListing(listing, providers);
  const { published } = await applyDecision(store, listing, verdict.decision, moderationReasonCode(verdict));
  await store.record({ subjectType: "listing", subjectId: listing.id, userId: listing.sellerId, verdict });
  return { status: "decided", decision: verdict.decision, reasons: verdict.reasons, published };
}

export type ManualDecisionResult =
  | { ok: true; published: boolean }
  | { ok: false; code: "vehicle_not_found" | "already_decided" };

/** Yönetim panelinden elle karar: onayla (yayına alır) ya da reddet (medyayı siler) */
export async function decideListingManually(
  store: ListingModerationStore,
  vehicleId: string,
  decision: "approve" | "reject",
  moderatorId: string,
): Promise<ManualDecisionResult> {
  const listing = await store.load(vehicleId);
  if (!listing) return { ok: false, code: "vehicle_not_found" };
  if (listing.moderationStatus !== "pending") return { ok: false, code: "already_decided" };

  const outcome: ModerationDecision = decision === "approve" ? "safe" : "rejected";
  const { published } = await applyDecision(store, listing, outcome, MANUAL_REASON);
  await store.record({
    subjectType: "listing",
    subjectId: listing.id,
    userId: listing.sellerId,
    moderatorId,
    verdict: { decision: outcome, reasons: [], scores: {}, provider: "manual" },
  });
  return { ok: true, published };
}

// ---------------------------------------------------------------
// Supabase deposu (servis anahtarı)
// ---------------------------------------------------------------

type ListingRow = {
  id: string;
  seller_id: string;
  status: VehicleStatus;
  moderation_status: ModerationStatus;
  moderation_reason: string | null;
  description: string | null;
  city: string | null;
  images: { image_url: string | null }[] | null;
  videos:
    | { stream_uid: string; status: string; hls_url: string | null; thumbnail_url: string | null; duration_seconds: number | null }[]
    | null;
};

export function toListingSnapshot(row: ListingRow): ListingSnapshot {
  const videos = row.videos ?? [];
  return {
    id: row.id,
    sellerId: row.seller_id,
    status: row.status,
    moderationStatus: row.moderation_status,
    moderationReason: row.moderation_reason,
    description: row.description,
    city: row.city,
    photoUrls: (row.images ?? []).flatMap((image) => (image.image_url ? [image.image_url] : [])),
    readyVideos: videos
      .filter((video) => video.status === "ready" && video.hls_url)
      .map((video) => ({ thumbnailUrl: video.thumbnail_url, durationSeconds: video.duration_seconds })),
    streamUids: videos.map((video) => video.stream_uid).filter(Boolean),
  };
}

export const LISTING_MODERATION_SELECT = `id, seller_id, status, moderation_status, moderation_reason, description, city,
  images:vehicle_images(image_url),
  videos(stream_uid, status, hls_url, thumbnail_url, duration_seconds)`;

export function createListingModerationStore(
  supabase: SupabaseClient,
  { now = () => new Date(), deleteVideo = deleteStreamVideo }: { now?: () => Date; deleteVideo?: (uid: string) => Promise<void> } = {},
): ListingModerationStore {
  return {
    async load(vehicleId) {
      const { data, error } = await supabase
        .from("vehicles")
        .select(LISTING_MODERATION_SELECT)
        .eq("id", vehicleId)
        .maybeSingle();
      if (error) throw error;
      return data ? toListingSnapshot(data as unknown as ListingRow) : null;
    },

    async approve(vehicleId, reason) {
      const decided = { moderation_status: "approved", moderation_reason: reason, moderated_at: now().toISOString() };
      // Karar ve yayın tek güncellemede: fn_check_vehicle_publishable 'approved'ı ister
      const { data, error } = await supabase
        .from("vehicles")
        .update({ ...decided, status: "active" })
        .eq("id", vehicleId)
        .eq("status", "pending_moderation")
        .eq("moderation_status", "pending")
        .select("id");
      if (error) throw error;
      if (data?.length) return { published: true };

      // Satıcı ilanı denetim sürerken arşive aldıysa: yalnızca karar (sonra kendisi yayına alabilir)
      const { error: approveError } = await supabase
        .from("vehicles")
        .update(decided)
        .eq("id", vehicleId)
        .eq("moderation_status", "pending");
      if (approveError) throw approveError;
      return { published: false };
    },

    async hold(vehicleId, reason) {
      const { error } = await supabase
        .from("vehicles")
        .update({ moderation_reason: reason })
        .eq("id", vehicleId)
        .eq("moderation_status", "pending");
      if (error) throw error;
    },

    async reject(vehicleId, reason) {
      const { error } = await supabase
        .from("vehicles")
        .update({
          status: "rejected",
          moderation_status: "rejected",
          moderation_reason: reason,
          moderated_at: now().toISOString(),
        })
        .eq("id", vehicleId)
        .eq("moderation_status", "pending");
      if (error) throw error;
    },

    async purgeMedia(listing) {
      const failures: string[] = [];
      for (const uid of listing.streamUids) {
        await deleteVideo(uid).catch((error) => {
          failures.push(uid);
          console.error("İçerik denetimi: Cloudflare videosu silinemedi (elle silinmeli):", uid, error);
        });
      }

      const { error: videosError } = await supabase.from("videos").delete().eq("vehicle_id", listing.id);
      if (videosError) failures.push("videos");

      // Klasördeki her dosya (vehicle_images'ta olmayanlar dahil)
      const bucket = supabase.storage.from(PHOTO_BUCKET);
      const { data: files, error: listError } = await bucket.list(listing.id, { limit: 100 });
      if (listError) failures.push("storage:list");
      const paths = (files ?? []).map((file) => `${listing.id}/${file.name}`);
      if (paths.length > 0) {
        const { error: removeError } = await bucket.remove(paths);
        if (removeError) failures.push("storage:remove");
      }

      const { error: imagesError } = await supabase.from("vehicle_images").delete().eq("vehicle_id", listing.id);
      if (imagesError) failures.push("vehicle_images");

      if (failures.length > 0) throw new Error(`Silinemeyenler: ${failures.join(", ")}`);
    },

    record: (event) => recordModerationEvent(supabase, event),
  };
}

/**
 * Webhook ve geliştirme rotası buradan çağırır. Hata fırlatmaz: denetim yarıda
 * kalırsa ilan 'pending_moderation'da kalır ve yönetim panelinde "Tekrar
 * denetle" ile yeniden başlatılabilir.
 */
export async function runListingModeration(vehicleId: string): Promise<ListingModerationResult | null> {
  try {
    return await moderateListing(vehicleId, {
      store: createListingModerationStore(getSupabaseAdmin()),
      providers: moderationProvidersFromEnv(),
    });
  } catch (error) {
    console.error("İçerik denetimi tamamlanamadı; ilan incelemede kalır:", vehicleId, error);
    return null;
  }
}
