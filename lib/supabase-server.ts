import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Sunucuya özel Supabase istemcisi. Gizli anahtarla çalışır ve RLS'i atlar:
// sadece Route Handler'larda, sahiplik gibi kontroller kodda yapıldıktan sonra
// kullanılmalı. NEXT_PUBLIC_ öneki olmayan değişkenler tarayıcı paketine girmez.

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Yeni anahtar formatı (sb_secret_...) ya da eski service_role anahtarı
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
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
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return null;

  const { data, error } = await getSupabaseAdmin().auth.getClaims(token);
  const claims = data?.claims;
  if (error || !claims?.sub || claims.role !== "authenticated" || claims.is_anonymous === true) {
    return null;
  }
  return claims.sub;
}