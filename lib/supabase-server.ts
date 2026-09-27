import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Sunucuya özel Supabase istemcisi. Gizli anahtarla çalışır ve RLS'i atlar:
// sadece Route Handler'larda, sahiplik gibi kontroller kodda yapıldıktan sonra
// kullanılmalı. NEXT_PUBLIC_ öneki olmayan değişkenler tarayıcı paketine girmez.

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Yeni anahtar formatı (sb_secret_...) ya da eski service_role anahtarı. Boş değer
  // "tanımsız" sayılır (||): Vercel'de boş bırakılan SECRET_KEY eskisine düşer.
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) {
    throw new Error(
      "Sunucu ortam değişkenleri eksik: NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SECRET_KEY " +
        "(ya da SUPABASE_SERVICE_ROLE_KEY) .env.local'de tanımlı olmalı.",
    );
  }

  adminClient = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return adminClient;
}

/**
 * "Authorization: Bearer <access_token>" başlığındaki Supabase oturumunu doğrular ve
 * kullanıcı id'sini döner. Tarayıcıda token: (await supabase.auth.getSession()).data.session?.access_token
 * getClaims: asimetrik JWT anahtarlarında imzayı yerelde (JWKS) doğrular, eski simetrik
 * anahtarlarda Supabase Auth'a sorar.
 */
export async function getAuthenticatedUserId(request: Request): Promise<string | null> {
  return (await getAuthenticatedUser(request))?.id ?? null;
}

/**
 * getAuthenticatedUserId gibi; ek olarak token'daki e-posta (küçük harf). Bu
 * e-posta token üretildiği andaki değerdir: yetki kararında tek başına
 * kullanılmaz (bkz. lib/moderation-server.ts checkAdminStatus).
 */
export async function getAuthenticatedUser(request: Request): Promise<{ id: string; email: string | null } | null> {
  const token = bearerToken(request);
  if (!token) return null;

  // Bozuk biçimli token'da getClaims hata döndürmek yerine fırlatıyor ("Invalid
  // UTF-8 sequence"); oturum yok sayılır (401), istek 500'e düşmez.
  let result: Awaited<ReturnType<SupabaseClient["auth"]["getClaims"]>>;
  try {
    result = await getSupabaseAdmin().auth.getClaims(token);
  } catch {
    return null;
  }
  const { data, error } = result;
  const claims = data?.claims;
  if (error || !claims?.sub || claims.role !== "authenticated" || claims.is_anonymous === true) {
    return null;
  }
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() || null : null;
  return { id: claims.sub, email };
}

/** "Authorization: Bearer <token>" başlığındaki token (doğrulanmamış) */
export function bearerToken(request: Request): string | null {
  return request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
}

/**
 * Kullanıcının kendi oturumuyla çalışan istemci: istekler tarayıcıdan gelmiş gibi
 * RLS'e ve tetikleyicilere tabidir. Sunucu bir işi kullanıcı adına yapıp araya
 * kendi denetimini koymak istediğinde (ör. /api/messages) kullanılır. Token önce
 * getAuthenticatedUserId ile doğrulanmalı.
 */
export function getSupabaseForUser(accessToken: string): SupabaseClient {
  return createPublishableClient(accessToken);
}

/**
 * Misafir istemcisi (yayımlanabilir anahtar, oturumsuz): herkese açık okumalar
 * RLS'e tabi, tarayıcıdaki misafirle aynı kurallarla yapılır.
 */
export function getSupabasePublic(): SupabaseClient {
  return createPublishableClient(null);
}

function createPublishableClient(accessToken: string | null): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Sunucu ortam değişkenleri eksik: NEXT_PUBLIC_SUPABASE_URL ve yayımlanabilir (anon) anahtar.");
  }
  return createClient(url, key, {
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
