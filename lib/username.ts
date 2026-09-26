// Kullanıcı adı kuralları. UI'dan bağımsız.
//
// Veritabanındaki kuralın (fn_is_valid_username, fn_reserved_usernames,
// *_usernames_and_follows.sql) birebir aynısı; eşitliği lib/social-rls.test.ts
// denetliyor. Kural değişirse ikisi birlikte değişmeli.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/** Sistem sayfaları, uygulama sözcükleri ve kurumsal adlar (alfabetik) */
export const RESERVED_USERNAMES: readonly string[] = [
  "_next", "about", "account", "admin", "akis", "anonim", "anonymous", "api", "ara", "arac",
  "araclar", "assets", "auth", "ayarlar", "bildirim", "bildirimler", "bot", "callback", "cikis", "contact",
  "dashboard", "destek", "email", "explore", "favicon", "favoriler", "favorites", "feed", "follow", "followers",
  "following", "giris", "gizlilik", "guvenlik", "hakkinda", "help", "hesap", "icons", "ilan", "ilan_ver",
  "ilanlar", "iletisim", "info", "kayit", "kesfet", "kosullar", "kullanici", "kvkk", "login", "logout",
  "mail", "manifest", "mesaj", "mesajlar", "messages", "moderation", "moderator", "my_listings", "notifications", "null",
  "official", "owner", "privacy", "profile", "profiles", "public", "register", "report", "reports", "resmi",
  "robots", "root", "search", "security", "sell", "settings", "signin", "signup", "sistem", "sitemap",
  "staff", "static", "support", "takip", "takipci", "takipciler", "team", "terms", "test", "undefined",
  "user", "users", "vehicles", "vitrin", "vitrinim", "www", "yardim", "yonetici", "yonetim",
];

const RESERVED_SET = new Set(RESERVED_USERNAMES);
/** Yetkili gibi görünen önekler */
const RESERVED_PREFIX = /^(admin|moderator|destek|support)/;
/** Marka adını içeren adlar (ör. gozuyle_destek) */
const BRAND = "gozuyle";

export function isReservedUsername(name: string): boolean {
  return RESERVED_SET.has(name) || name.includes(BRAND) || RESERVED_PREFIX.test(name);
}

/** Sunucunun (check_username / set_username) yaptığı gibi: boşluk kırpılır, küçük harfe çevrilir */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export type UsernameStatus = "invalid" | "reserved" | "taken" | "available" | "current";

/** Ağa gitmeden bilinebilen sonuç: biçim ya da rezerve; yoksa null (sunucuya sorulur) */
export function localUsernameStatus(name: string): "invalid" | "reserved" | null {
  if (!USERNAME_PATTERN.test(name)) return "invalid";
  if (isReservedUsername(name)) return "reserved";
  return null;
}

const TURKISH_MAP: Record<string, string> = {
  ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u",
  Ç: "c", Ğ: "g", I: "i", İ: "i", Ö: "o", Ş: "s", Ü: "u", Â: "a", Î: "i", Û: "u",
  // "İ".toLowerCase() → "i" + birleşik nokta (U+0307)
  "i̇": "i",
};

/**
 * Yazılırken alana uygulanır: baştaki @ atılır, Türkçe harfler karşılığına
 * (ş → s), boşluk ve tire alt çizgiye döner, küçük harfe çevrilir; izin
 * verilmeyen diğer karakterler düşer. En fazla 20 karakter.
 */
export function sanitizeUsernameInput(input: string): string {
  return input
    .replace(/^@+/, "")
    .replace(/i\u0307|[çğıöşüâîûÇĞIİÖŞÜÂÎÛ]/g, (ch) => TURKISH_MAP[ch] ?? ch)
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, USERNAME_MAX);
}

/**
 * Öneri: görünen ad (Google'dan gelen ad dahil), yoksa e-postanın @ öncesi.
 * Kurala uymazsa (kısa, rezerve) boş döner; kullanıcı kendisi yazar.
 */
export function suggestUsername(displayName: string | null | undefined, email: string | null | undefined): string {
  const candidates = [displayName ?? "", (email ?? "").split("@")[0]];
  for (const raw of candidates) {
    const name = sanitizeUsernameInput(raw.replace(/[._]+/g, "_")).replace(/^_+|_+$/g, "").replace(/_{2,}/g, "_");
    if (localUsernameStatus(name) === null) return name;
  }
  return "";
}

/** Profil sayfasının adresi: /@kullanici_adi */
export function profilePath(username: string): string {
  return `/@${username}`;
}

/** Kullanıcıya gösterilen açıklama */
export const USERNAME_STATUS_MESSAGES: Record<UsernameStatus, string> = {
  invalid: "3–20 karakter; yalnızca küçük harf, rakam ve alt çizgi (_).",
  reserved: "Bu kullanıcı adı sisteme ayrılmış, başka bir ad dene.",
  taken: "Bu kullanıcı adı alınmış.",
  available: "Bu kullanıcı adı müsait.",
  current: "Bu zaten senin kullanıcı adın.",
};
