import type { SupabaseClient } from "@supabase/supabase-js";

// /cansu-kamil kapatma düğmesi (kill-switch). Durum public.app_settings'te
// (20261018120000_app_settings.sql); yalnızca sunucu okur/yazar.
//
// ?admin=kamil yalnızca düğmeyi gösterir: kapatma isteği yönetici oturumu ister
// (POST /api/admin/cansu-kamil, ADMIN_EMAILS). Adresi bilen biri sayfayı
// kapatamaz.

export const CANSU_DISABLED_KEY = "cansu_kamil_disabled";
export const CANSU_ADMIN_PARAM = "kamil";

/** Düğme görünsün mü: ?admin=kamil (tekrarlanan parametrede herhangi biri) */
export function shouldShowKillSwitch(admin: string | string[] | undefined): boolean {
  return Array.isArray(admin) ? admin.includes(CANSU_ADMIN_PARAM) : admin === CANSU_ADMIN_PARAM;
}

/**
 * Sayfa kapatıldı mı? Okunamazsa (tablo henüz yok, ağ hatası, sunucu anahtarı
 * eksik) açık sayılır: geçici bir veritabanı sorunu sayfayı 404'e düşürmez.
 * İstemci tembel alınır; oluşturulamazsa (env eksik) o hata da yakalanır.
 */
export async function isCansuPageDisabled(getClient: () => SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await getClient()
      .from("app_settings")
      .select("value")
      .eq("key", CANSU_DISABLED_KEY)
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

/** İstek gövdesi: { disabled: boolean } */
export function parseKillSwitchBody(body: unknown): { ok: true; disabled: boolean } | { ok: false } {
  if (body && typeof body === "object" && typeof (body as { disabled?: unknown }).disabled === "boolean") {
    return { ok: true, disabled: (body as { disabled: boolean }).disabled };
  }
  return { ok: false };
}

export async function setCansuPageDisabled(
  supabase: SupabaseClient,
  disabled: boolean,
  adminUserId: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabase.from("app_settings").upsert(
    { key: CANSU_DISABLED_KEY, value: disabled, updated_at: new Date().toISOString(), updated_by: adminUserId },
    { onConflict: "key" },
  );
  if (error) console.error("app_settings yazılamadı:", error.message);
  return { ok: !error };
}
