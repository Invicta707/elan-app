// Google ile girişte dönüş adresi. Kullanıcı Google'a gidip /auth/callback'e
// döner; giriş penceresini açtığı sayfaya (ya da "+ İlan Ver" ile gideceği
// sayfaya) geri götürülür. UI'dan bağımsız: testleri lib/auth-redirect.test.ts'de.

/** Google'a gitmeden önce dönüş yolu burada saklanır (sadece bu sekme) */
export const AUTH_RETURN_KEY = "gozuyle:auth-return";

export const AUTH_CALLBACK_PATH = "/auth/callback";

/**
 * Sadece site içi göreli yollar kabul edilir: "//baska.site" ya da "https://..."
 * gibi değerlerle kullanıcı başka bir siteye yönlendirilemez. Geri dönüş
 * sayfasının kendisi de kabul edilmez (döngü olmasın).
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  try {
    const url = new URL(value, "https://gozuyle.invalid");
    if (url.origin !== "https://gozuyle.invalid") return "/";
    if (url.pathname === AUTH_CALLBACK_PATH) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

/** Google'ın ya da Supabase'in dönüş adresine eklediği hata; yoksa null */
export function oauthErrorMessage(search: string, hash: string): string | null {
  const params = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const code = params.get("error") ?? fragment.get("error");
  if (!code) return null;
  if (code === "access_denied") return "Google ile giriş iptal edildi.";
  return "Google ile giriş tamamlanamadı. Tekrar dene ya da e-postayla giriş yap.";
}
