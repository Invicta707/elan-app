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
