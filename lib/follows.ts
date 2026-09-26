import type { SupabaseClient } from "@supabase/supabase-js";
import { LISTING_SELECT, toMyListing, type MyListing, type MyListingRow } from "./my-listings";
import { supabase } from "./supabase";
import { USERNAME_PATTERN, normalizeUsername } from "./username";

// Takip sistemi ve herkese açık profil (/@kullanici_adi): tipler, veritabanı
// çağrıları ve dönüşümler. UI'dan bağımsız. Yetkiler veritabanında:
// supabase/migrations/*_usernames_and_follows.sql

/** /@kullanici_adi sayfasının başlığı */
export type ProfilePageData = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  followersCount: number;
  followingCount: number;
  listingsCount: number;
  /** Oturumdaki kullanıcının kendi profili mi (misafirde false) */
  isMe: boolean;
  /** Oturumdaki kullanıcı takip ediyor mu (misafirde false) */
  isFollowing: boolean;
};

/** Akış kartı ve ilan sayfasındaki satıcı satırı */
export type SellerProfile = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isFollowing: boolean;
};

type Json = Record<string, unknown>;

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const count = (value: unknown): number => Math.max(0, Number(value) || 0);

export function toProfilePageData(raw: unknown): ProfilePageData | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Json;
  const id = text(row.id);
  const username = text(row.username);
  if (!id || !username) return null;
  return {
    id,
    username,
    displayName: text(row.display_name),
    avatarUrl: text(row.avatar_url),
    followersCount: count(row.followers_count),
    followingCount: count(row.following_count),
    listingsCount: count(row.listings_count),
    isMe: row.is_me === true,
    isFollowing: row.is_following === true,
  };
}

export function toSellerProfile(raw: unknown): SellerProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Json;
  const id = text(row.id);
  if (!id) return null;
  return {
    id,
    username: text(row.username),
    displayName: text(row.display_name),
    avatarUrl: text(row.avatar_url),
    isFollowing: row.is_following === true,
  };
}

/** Adresteki adı (/@Kamil) kurala göre okur; geçersizse null */
export function parseProfileParam(param: string): string | null {
  let decoded = param;
  try {
    decoded = decodeURIComponent(param);
  } catch {
    return null;
  }
  const name = normalizeUsername(decoded.replace(/^@/, ""));
  return USERNAME_PATTERN.test(name) ? name : null;
}

/**
 * Herkese açık profil. Sunucuda anonim istemciyle (takip durumu false), tarayıcıda
 * oturumlu istemciyle çağrılır. Kullanıcı yoksa null.
 */
export async function fetchProfilePage(username: string, client: SupabaseClient = supabase): Promise<ProfilePageData | null> {
  const { data, error } = await client.rpc("get_public_profile", { p_username: username });
  if (error) throw error;
  return toProfilePageData(data);
}

/** Satıcıların kısa profili (en fazla 50 kimlik); herkese açık yüzü olmayanlar dönmez */
export async function fetchSellerProfiles(ids: readonly string[], client: SupabaseClient = supabase): Promise<SellerProfile[]> {
  const unique = [...new Set(ids)].slice(0, 50);
  if (unique.length === 0) return [];
  const { data, error } = await client.rpc("get_public_profiles", { p_ids: unique });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(toSellerProfile).filter((p): p is SellerProfile => p !== null);
}

/** Profil ızgarası: kullanıcının yalnızca yayındaki ilanları, en yeni önce */
export async function fetchPublicListings(sellerId: string, client: SupabaseClient = supabase): Promise<MyListing[]> {
  const { data, error } = await client
    .from("vehicles")
    .select(LISTING_SELECT)
    .eq("seller_id", sellerId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw error;
  return ((data ?? []) as unknown as MyListingRow[]).map(toMyListing);
}

/** Veritabanı hatasını kullanıcıya gösterilecek metne çevirir */
export function followErrorMessage(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  switch (code) {
    // Hız ve üst sınır: mesaj veritabanından, Türkçe
    case "23514":
      return message || "Şu an takip edilemiyor.";
    // RLS: engel var ya da oturum düştü
    case "42501":
      return "Bu kullanıcıyı takip edemezsin.";
    case "23503":
      return "Kullanıcı bulunamadı.";
    default:
      return "İşlem tamamlanamadı. Bağlantını kontrol edip tekrar dene.";
  }
}

/** Takip et; zaten takip ediliyorsa başarılı sayılır */
export async function followUser(followerId: string, targetId: string): Promise<void> {
  const { error } = await supabase.from("follows").insert({ follower_id: followerId, following_id: targetId });
  if (error && error.code !== "23505") throw error;
}

/** Takibi bırak; zaten takip edilmiyorsa sessizce geçer */
export async function unfollowUser(followerId: string, targetId: string): Promise<void> {
  const { error } = await supabase.from("follows").delete().eq("follower_id", followerId).eq("following_id", targetId);
  if (error) throw error;
}
