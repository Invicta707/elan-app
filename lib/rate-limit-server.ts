import "server-only";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Kalıcı istek sınırı: veritabanındaki sayaç (public.fn_rate_limit_hit,
// supabase/migrations/*_rate_limits.sql). Bütün sunucu örnekleri aynı sayacı
// görür. Bellek içi sınır (lib/rate-limit.ts) önünde ucuz bir ilk katmandır.

export type RateRule = {
  /** ip: istemci adresi (IPv6'da /64), user: giriş yapmış kullanıcı */
  scope: "ip" | "user";
  limit: number;
  windowSeconds: number;
};

export type RateLimitDecision = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Sayaç anahtarı: "<ad>:<kapsam>:<HMAC-SHA256>". IP ya da kullanıcı id'si
 * veritabanına düz yazılmaz. Anahtarlı özet kullanılır: düz SHA-256, IPv4'ün
 * küçük uzayında kaba kuvvetle geri çözülebilirdi.
 */
export function rateLimitKey(name: string, scope: RateRule["scope"], identity: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(`${name}:${scope}:${identity}`).digest("hex");
  return `${name}:${scope}:${digest}`;
}

/**
 * Özet anahtarı: sunucudaki Supabase gizli anahtarı (tarayıcıya hiç gitmez).
 * Anahtar değişirse sayaçlar sıfırlanmış olur; başka bir etkisi yoktur.
 */
export function rateLimitSecret(): string {
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("İstek sınırı için SUPABASE_SECRET_KEY (ya da SUPABASE_SERVICE_ROLE_KEY) gerekli.");
  return secret;
}

/**
 * Kuralların hepsini tek çağrıda sayar. Kullanıcı kuralları yalnızca oturum
 * varsa uygulanır. Sayaç okunamazsa istek geçer (hata kaydedilir): bellek içi
 * sınır yine çalışır ve veritabanına ulaşılamıyorsa bildirim de kaydedilemez.
 */
export async function consumeRateLimit(
  supabase: SupabaseClient,
  name: string,
  rules: readonly RateRule[],
  identities: { ip: string; userId: string | null },
  secret: string,
): Promise<RateLimitDecision> {
  const applicable = rules.filter((rule) => rule.scope === "ip" || identities.userId);
  if (applicable.length === 0) return { ok: true };

  const { data, error } = await supabase.rpc("fn_rate_limit_hit", {
    p_keys: applicable.map((rule) =>
      rateLimitKey(name, rule.scope, rule.scope === "ip" ? identities.ip : (identities.userId as string), secret),
    ),
    p_limits: applicable.map((rule) => rule.limit),
    p_window_seconds: applicable.map((rule) => rule.windowSeconds),
  });

  if (error) {
    console.error(`İstek sınırı (${name}) okunamadı; istek sınırsız geçiyor:`, error);
    return { ok: true };
  }

  const retryAfterSeconds = Number(data) || 0;
  return retryAfterSeconds > 0 ? { ok: false, retryAfterSeconds } : { ok: true };
}
