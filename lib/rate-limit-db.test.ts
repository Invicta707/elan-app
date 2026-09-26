// Kalıcı istek sınırı: 20260926190000_rate_limits.sql gerçek bir Postgres'te
// (PGlite) çalıştırılır. consumeRateLimit'in rpc çağrısı aynı veritabanına
// yönlendirilerek uygulamanın gönderdiği anahtarlar da sınanır.

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { consumeRateLimit, rateLimitKey, type RateRule } from "./rate-limit-server";
import { REPORT_RATE_RULES } from "./reports";

const MIGRATION = readFileSync("supabase/migrations/20260926190000_rate_limits.sql", "utf8");

const BASE_SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase'in varsayılan yetkileri: public'teki yeni tablolar herkese açılır
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;

const T0 = "2026-09-26T12:00:15Z";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_SCHEMA);
  await db.exec(MIGRATION);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("delete from public.rate_limits");
});

/** Servis anahtarıyla fn_rate_limit_hit; dönen değer Retry-After saniyesi (0 = izin) */
async function hit(keys: string[], limits: number[], windows: number[], now = T0): Promise<number> {
  const { rows } = await db.query<{ retry: number }>(
    "select public.fn_rate_limit_hit($1, $2, $3, $4) as retry",
    [keys, limits, windows, now],
  );
  return rows[0].retry;
}

async function rowCount(): Promise<number> {
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.rate_limits");
  return rows[0].n;
}

describe("fn_rate_limit_hit", () => {
  it("sınıra kadar izin verir, sonra pencerenin bitişine kalan süreyi döner", async () => {
    for (let i = 0; i < 3; i++) expect(await hit(["k"], [3], [60])).toBe(0);
    // 12:00:15 → pencere 12:00:00–12:01:00, 45 sn kaldı
    expect(await hit(["k"], [3], [60])).toBe(45);
    expect(await hit(["k"], [3], [60], "2026-09-26T12:00:59.5Z")).toBe(1);
  });

  it("yeni pencerede sayaç sıfırdan başlar", async () => {
    for (let i = 0; i < 4; i++) await hit(["k"], [3], [60]);
    expect(await hit(["k"], [3], [60], "2026-09-26T12:01:00Z")).toBe(0);
  });

  it("anahtarlar birbirinden bağımsızdır", async () => {
    for (let i = 0; i < 4; i++) await hit(["a"], [3], [60]);
    expect(await hit(["b"], [3], [60])).toBe(0);
  });

  it("aynı anahtarın dakika ve saat pencereleri ayrı sayılır (aynı başlangıçta bile)", async () => {
    // 12:00:15'te iki pencere de 12:00:00'da başlıyor
    for (let i = 0; i < 3; i++) expect(await hit(["k", "k"], [3, 5], [60, 3600])).toBe(0);
    // Dakika sınırı aşıldı: 45 sn
    expect(await hit(["k", "k"], [3, 5], [60, 3600])).toBe(45);
    // Yeni dakika, saatin 5. isteği: izin; 6.: saat sınırı (12:02:00 → 58 dk)
    expect(await hit(["k", "k"], [3, 5], [60, 3600], "2026-09-26T12:01:10Z")).toBe(0);
    expect(await hit(["k", "k"], [3, 5], [60, 3600], "2026-09-26T12:02:00Z")).toBe(58 * 60);
  });

  it("birden fazla kural aşılırsa en geç biten pencere döner", async () => {
    for (let i = 0; i < 2; i++) await hit(["m", "h"], [1, 1], [60, 3600]);
    expect(await hit(["m", "h"], [1, 1], [60, 3600])).toBe(3600 - 15);
  });

  it("reddedilen istekler de sayılır", async () => {
    for (let i = 0; i < 10; i++) await hit(["k"], [3], [60]);
    const { rows } = await db.query<{ hits: number }>("select hits from public.rate_limits where key = 'k'");
    expect(rows[0].hits).toBe(10);
  });

  it("süresi dolan sayaçlar sonraki çağrıda silinir", async () => {
    await hit(["eski-dakika"], [3], [60]);
    await hit(["eski-gun"], [3], [86400]);
    expect(await rowCount()).toBe(2);

    await hit(["yeni"], [3], [60], "2026-09-26T12:05:00Z");
    const { rows } = await db.query<{ key: string }>("select key from public.rate_limits order by key");
    expect(rows.map((r) => r.key)).toEqual(["eski-gun", "yeni"]);

    await hit(["yeni"], [3], [60], "2026-09-27T00:00:00Z");
    expect((await db.query<{ key: string }>("select key from public.rate_limits")).rows.map((r) => r.key)).toEqual([
      "yeni",
    ]);
  });

  it.each([
    ["boş dizi", [], [], []],
    ["uzunluklar uyuşmuyor", ["k"], [3, 4], [60]],
    ["sıfır sınır", ["k"], [0], [60]],
    ["sıfır pencere", ["k"], [3], [0]],
  ])("geçersiz kural reddedilir: %s", async (_label, keys, limits, windows) => {
    await expect(hit(keys as string[], limits as number[], windows as number[])).rejects.toThrow(/fn_rate_limit_hit/);
  });

  it("tablo ve fonksiyon yalnızca sunucuya (service_role) açık", async () => {
    const { rows } = await db.query<Record<string, boolean>>(
      `select has_function_privilege('anon', 'public.fn_rate_limit_hit(text[], integer[], integer[], timestamptz)', 'execute') as anon_exec,
              has_function_privilege('authenticated', 'public.fn_rate_limit_hit(text[], integer[], integer[], timestamptz)', 'execute') as auth_exec,
              has_function_privilege('service_role', 'public.fn_rate_limit_hit(text[], integer[], integer[], timestamptz)', 'execute') as service_exec,
              has_table_privilege('anon', 'public.rate_limits', 'select') as anon_select,
              has_table_privilege('authenticated', 'public.rate_limits', 'insert') as auth_insert,
              (select relrowsecurity from pg_class where oid = 'public.rate_limits'::regclass) as rls`,
    );
    expect(rows[0]).toEqual({
      anon_exec: false,
      auth_exec: false,
      service_exec: true,
      anon_select: false,
      auth_insert: false,
      rls: true,
    });
  });
});

describe("rateLimitKey", () => {
  it("kimliği düz içermez; aynı girdi aynı anahtarı, farklı gizli anahtar farklı özeti verir", () => {
    const key = rateLimitKey("reports", "ip", "203.0.113.1", "s1");
    expect(key).toMatch(/^reports:ip:[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.1");
    expect(rateLimitKey("reports", "ip", "203.0.113.1", "s1")).toBe(key);
    expect(rateLimitKey("reports", "ip", "203.0.113.1", "s2")).not.toBe(key);
    expect(rateLimitKey("reports", "user", "203.0.113.1", "s1")).not.toBe(key);
  });
});

describe("consumeRateLimit + veritabanı", () => {
  // Supabase istemcisinin rpc'si PGlite'taki fonksiyona gider (servis anahtarı gibi)
  const supabase = {
    rpc: async (name: string, args: { p_keys: string[]; p_limits: number[]; p_window_seconds: number[] }) => {
      try {
        const { rows } = await db.query<{ retry: number }>(`select public.${name}($1, $2, $3) as retry`, [
          args.p_keys,
          args.p_limits,
          args.p_window_seconds,
        ]);
        return { data: rows[0].retry, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  } as unknown as SupabaseClient;

  const anonymousRules: readonly RateRule[] = REPORT_RATE_RULES.anonymous;
  const authenticatedRules: readonly RateRule[] = REPORT_RATE_RULES.authenticated;

  it("anonim: 5. istekten sonra reddedilir; tabloda IP geçmez", async () => {
    const identities = { ip: "203.0.113.1", userId: null };
    for (let i = 0; i < 5; i++) {
      expect(await consumeRateLimit(supabase, "reports", anonymousRules, identities, "s")).toEqual({ ok: true });
    }
    const limited = await consumeRateLimit(supabase, "reports", anonymousRules, identities, "s");
    expect(limited).toMatchObject({ ok: false });
    expect(limited.ok === false && limited.retryAfterSeconds).toBeGreaterThan(0);

    const { rows } = await db.query<{ key: string }>("select key from public.rate_limits");
    expect(rows).toHaveLength(2);
    for (const { key } of rows) expect(key).not.toContain("203.0.113.1");
  });

  it("aynı IP'yi paylaşan giriş yapmış kullanıcılar birbirini engellemez", async () => {
    for (let n = 0; n < 5; n++) {
      const userId = `user-${n}`;
      for (let i = 0; i < 5; i++) {
        const decision = await consumeRateLimit(supabase, "reports", authenticatedRules, { ip: "100.64.0.1", userId }, "s");
        expect(decision).toEqual({ ok: true });
      }
    }
    // Aynı kullanıcının 6. isteği reddedilir
    expect(
      await consumeRateLimit(supabase, "reports", authenticatedRules, { ip: "100.64.0.1", userId: "user-0" }, "s"),
    ).toMatchObject({ ok: false });
  });

  it("kullanıcı kuralları oturum yoksa uygulanmaz", async () => {
    await consumeRateLimit(supabase, "reports", authenticatedRules, { ip: "203.0.113.9", userId: null }, "s");
    const { rows } = await db.query<{ key: string }>("select key from public.rate_limits");
    expect(rows.map((r) => r.key.split(":")[1])).toEqual(["ip"]);
  });
});
