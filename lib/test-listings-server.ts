import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteStreamVideo } from "./cloudflare";
import { PHOTO_BUCKET } from "./listing";
import { toTestListing, type TestListing, type TestListingDeletion, type TestListingRow } from "./moderation";

// Test (deneme) ilanları, servis anahtarıyla (yalnızca app/api/admin/test-listings).
// Silme sırası: önce Cloudflare videoları ve Storage'daki fotoğraflar, sonra
// ilan satırı (videos, vehicle_images, yorumlar, şikayetler, sohbetler CASCADE ile
// gider). Medyası silinemeyen ilanın satırı bırakılır: yetim video kalmaz,
// yönetici düğmeye yeniden basarak tekrar dener. Yalnızca is_test = true
// satırlara dokunulur.

export const TEST_LISTING_SELECT = `id, status, year, price, currency, city, created_at,
  brand:brands(name), model:models(name),
  videos(stream_uid, thumbnail_url, status),
  vehicle_images(image_url, is_primary, display_order)`;

/** Panelde listelenen en fazla test ilanı (tohumlama betiği 5 açar) */
export const TEST_LISTINGS_LIMIT = 100;

export async function fetchTestListingRows(
  supabase: SupabaseClient,
): Promise<{ ok: true; items: TestListing[] } | { ok: false }> {
  const { data, error } = await supabase
    .from("vehicles")
    .select(TEST_LISTING_SELECT)
    .eq("is_test", true)
    .order("created_at", { ascending: false })
    .limit(TEST_LISTINGS_LIMIT);
  if (error) {
    console.error("Test ilanları okunamadı:", error);
    return { ok: false };
  }
  return { ok: true, items: ((data ?? []) as unknown as TestListingRow[]).map(toTestListing) };
}

type TestListingMediaRow = { id: string; videos: { stream_uid: string }[] | null };

export async function removeTestListings(
  supabase: SupabaseClient,
  { deleteVideo = deleteStreamVideo }: { deleteVideo?: (streamUid: string) => Promise<void> } = {},
): Promise<({ ok: true } & TestListingDeletion) | { ok: false }> {
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, videos(stream_uid)")
    .eq("is_test", true)
    .limit(TEST_LISTINGS_LIMIT);
  if (error) {
    console.error("Test ilanları okunamadı:", error);
    return { ok: false };
  }

  const failures: string[] = [];
  const cleared: string[] = [];
  const bucket = supabase.storage.from(PHOTO_BUCKET);

  for (const listing of (data ?? []) as unknown as TestListingMediaRow[]) {
    const problems: string[] = [];

    for (const { stream_uid: uid } of listing.videos ?? []) {
      await deleteVideo(uid).catch((cause) => {
        console.error("Test ilanı: Cloudflare videosu silinemedi:", uid, cause);
        problems.push(`video ${uid}`);
      });
    }

    // Klasördeki her dosya (vehicle_images'ta olmayanlar dahil)
    const { data: files, error: listError } = await bucket.list(listing.id, { limit: 100 });
    if (listError) problems.push("fotoğraf listesi");
    const paths = (files ?? []).map((file) => `${listing.id}/${file.name}`);
    if (paths.length > 0) {
      const { error: removeError } = await bucket.remove(paths);
      if (removeError) problems.push("fotoğraflar");
    }

    if (problems.length > 0) failures.push(`${listing.id}: ${problems.join(", ")}`);
    else cleared.push(listing.id);
  }

  if (cleared.length === 0) return { ok: true, deleted: 0, failures };

  const { data: deleted, error: deleteError } = await supabase
    .from("vehicles")
    .delete()
    .in("id", cleared)
    .eq("is_test", true)
    .select("id");
  if (deleteError) {
    console.error("Test ilanları silinemedi:", deleteError);
    return { ok: false };
  }

  return { ok: true, deleted: deleted?.length ?? 0, failures };
}
