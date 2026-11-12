import type { SupabaseClient } from "@supabase/supabase-js";

// /hatunum aç/kapa anahtarı. Durum public.app_settings'te
// (20261018120000_app_settings.sql, yalnızca sunucu okur/yazar):
//   key = 'hatunum_enabled', value = true → sayfa açık
// Satır yoksa, değer true değilse ya da okunamazsa sayfa KAPALI sayılır (404).
// /cansu-kamil'in tersine burada varsayılan kapalıdır: kişisel sayfa ancak
// yönetici açıkça açınca görünür.
//
// Değiştirmek: /admin/reports → "Hatunum sayfası" (POST /api/admin/hatunum,
// ADMIN_EMAILS yönetici oturumu).

export const HATUNUM_ENABLED_KEY = "hatunum_enabled";

export async function isHatunumEnabled(getClient: () => SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await getClient()
      .from("app_settings")
      .select("value")
      .eq("key", HATUNUM_ENABLED_KEY)
      .maybeSingle();
    if (error) {
      console.error("app_settings okunamadı:", error.message);
      return false;
    }
    return data?.value === true;
  } catch (error) {
    console.error("app_settings okunamadı:", error);
    return false;
  }
}

/** İstek gövdesi: { enabled: boolean } */
export function parseHatunumBody(body: unknown): { ok: true; enabled: boolean } | { ok: false } {
  if (body && typeof body === "object" && typeof (body as { enabled?: unknown }).enabled === "boolean") {
    return { ok: true, enabled: (body as { enabled: boolean }).enabled };
  }
  return { ok: false };
}

export async function setHatunumEnabled(
  supabase: SupabaseClient,
  enabled: boolean,
  adminUserId: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabase.from("app_settings").upsert(
    { key: HATUNUM_ENABLED_KEY, value: enabled, updated_at: new Date().toISOString(), updated_by: adminUserId },
    { onConflict: "key" },
  );
  if (error) console.error("app_settings yazılamadı:", error.message);
  return { ok: !error };
}
