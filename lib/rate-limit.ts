// Bellek içi, anahtar (IP) başına basit istek sınırı: kayan pencere.
//
// Sayaçlar sunucu örneğinin belleğinde tutulur. Vercel aynı anda birden fazla
// örnek çalıştırırsa sınır örnek başına uygulanır, örnek yeniden başlarsa
// sayaçlar sıfırlanır. Tek kaynaktan gelen ani spam'i keser; kesin ve kalıcı
// bir sınır için Vercel Firewall kuralı ya da paylaşılan bir sayaç gerekir.

export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

export type RateLimiterOptions = {
  /** Pencere içinde izin verilen istek sayısı */
  limit: number;
  windowMs: number;
  /** Bellekte tutulan en fazla anahtar; aşılınca en uzun süredir istek gelmeyen atılır */
  maxKeys?: number;
  now?: () => number;
};

export function createRateLimiter({
  limit,
  windowMs,
  maxKeys = 10_000,
  now = () => Date.now(),
}: RateLimiterOptions): (key: string) => RateLimitResult {
  // anahtar -> penceredeki kabul edilmiş isteklerin zamanları (eskiden yeniye).
  // Map ekleme sırasını korur: her istekte anahtar sona taşınır, baştaki en eskidir.
  const hits = new Map<string, number[]>();

  return (key) => {
    const at = now();
    const recent = (hits.get(key) ?? []).filter((t) => at - t < windowMs);
    hits.delete(key);
    hits.set(key, recent);

    if (recent.length >= limit) {
      // Reddedilen istekler sayılmaz: bekleme, penceredeki en eski istekten hesaplanır
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - at) / 1000)) };
    }

    recent.push(at);
    if (hits.size > maxKeys) hits.delete(hits.keys().next().value!);
    return { ok: true, remaining: limit - recent.length };
  };
}

/**
 * İsteği yapan istemcinin IP adresi. Vercel x-real-ip ve x-forwarded-for
 * başlıklarını kendisi yazar (istemcinin gönderdiğini ezer). Başlık yoksa
 * (yerel geliştirme) "unknown" döner; bu istekler tek sayaçta toplanır.
 */
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * Sınırın sayılacağı özne. IPv6'da tek bir bağlantının elinde koca bir /64 blok
 * olur ve adres her istekte değiştirilebilir; bu yüzden /64 önekine göre
 * sayılır. IPv4'e eşlenmiş IPv6 (::ffff:1.2.3.4) IPv4 sayılır.
 */
export function rateLimitSubject(ip: string): string {
  const value = ip.trim().toLowerCase().split("%")[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped) return mapped[1];
  if (!value.includes(":")) return value;
  return ipv6Prefix64(value) ?? value;
}

function ipv6Prefix64(ip: string): string | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(":") : [];
  let groups = left;
  if (halves.length === 2) {
    const right = halves[1] ? halves[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  }

  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}
