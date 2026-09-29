// Güvenlik testleri: ilan izlenme sayacı (20260929100000_vehicle_views.sql).
//
// Migration gerçek bir Postgres'te (PGlite) çalışır; istekler Supabase'deki gibi
// rol (set role) ve JWT claim'leriyle taklit edilir. Sayaç koruması
// (fn_guard_vehicle_counters) yorum migration'ındaki gövdesiyle kurulur, sonra
// izlenme migration'ı uygulanır. Beklenen: sayacı yalnızca
// increment_vehicle_view artırır (tam +1, yalnızca yayındaki hedef ilan);
// istemcinin doğrudan yazdığı değer yok sayılır; diğer sayaçların koruması aynı.

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = readFileSync("supabase/migrations/20260929100000_vehicle_views.sql", "utf8");
const COMMENTS_MIGRATION = readFileSync("supabase/migrations/20260928160000_vehicle_comments.sql", "utf8");

/** Yorum migration'ının yazdığı sayaç koruması (canlıdaki gövde), olduğu gibi */
const PREVIOUS_GUARD = (() => {
  const start = COMMENTS_MIGRATION.indexOf("create or replace function public.fn_guard_vehicle_counters()");
  const end = COMMENTS_MIGRATION.indexOf("$function$;", start) + "$function$;".length;
  return COMMENTS_MIGRATION.slice(start, end);
})();

const SELLER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const BASE_SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                    nullif(current_setting('request.jwt.claims', true), ''))::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;

  create table public.vehicles (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null,
    status text not null default 'draft',
    city text,
    likes_count integer not null default 0,
    views_count integer not null default 0,
    saves_count integer not null default 0,
    comments_count integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  -- Supabase'in varsayılanı: tablo düzeyinde bütün yetkiler, satırları RLS süzer
  grant all on public.vehicles to anon, authenticated, service_role;
  alter table public.vehicles enable row level security;
  create policy vehicles_select on public.vehicles for select using (status = 'active' or auth.uid() = seller_id);
  create policy vehicles_update_own on public.vehicles for update using (auth.uid() = seller_id);

  -- Kaydetme sayacı gibi: sayaç bir tetikleyicinin içinden (derinlik 2) artar
  create table public.saves (vehicle_id uuid not null references public.vehicles(id));
  grant all on public.saves to anon, authenticated, service_role;
  create function public.fn_saves_count() returns trigger language plpgsql security definer as $$
  begin
    update public.vehicles set saves_count = saves_count + 1 where id = new.vehicle_id;
    return new;
  end;
  $$;
  create trigger trg_saves_count after insert on public.saves for each row execute function public.fn_saves_count();
`;

const GUARD_TRIGGER = `
  create trigger trg_vehicles_guard_counters before insert or update on public.vehicles
    for each row execute function public.fn_guard_vehicle_counters();
`;

type Actor = { role: "anon" | "authenticated" | "service_role" | null; claims: Record<string, string> | null };
const seller: Actor = { role: "authenticated", claims: { role: "authenticated", sub: SELLER } };
const member: Actor = { role: "authenticated", claims: { role: "authenticated", sub: OTHER } };
const anon: Actor = { role: "anon", claims: { role: "anon" } };
const serviceRole: Actor = { role: "service_role", claims: { role: "service_role" } };

type Outcome<T = Record<string, unknown>> = { ok: true; rows: T[] } | { ok: false; code: string; message: string };

async function runOn<T = Record<string, unknown>>(db: PGlite, actor: Actor, sql: string, params: unknown[] = []): Promise<Outcome<T>> {
  try {
    return await db.transaction(async (tx) => {
      if (actor.role) await tx.exec(`set local role ${actor.role}`);
      if (actor.claims) await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(actor.claims)]);
      const result = await tx.query<T>(sql, params);
      return { ok: true as const, rows: result.rows };
    });
  } catch (error) {
    const { code = "", message = "" } = error as { code?: string; message?: string };
    return { ok: false, code, message };
  }
}

let db: PGlite;
const run = <T = Record<string, unknown>>(actor: Actor, sql: string, params: unknown[] = []) => runOn<T>(db, actor, sql, params);

type Counters = { views_count: number; likes_count: number; saves_count: number; comments_count: number; updated_at: string };

async function counters(id: string): Promise<Counters> {
  const { rows } = await db.query<Counters>(
    "select views_count, likes_count, saves_count, comments_count, updated_at::text from public.vehicles where id = $1",
    [id],
  );
  return rows[0];
}

async function listing(status = "active"): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.vehicles (seller_id, status, created_at, updated_at) values ($1, $2, now() - interval '1 day', now() - interval '1 day') returning id",
    [SELLER, status],
  );
  return rows[0].id;
}

const view = (actor: Actor, id: string | null) =>
  run<{ increment_vehicle_view: number | null }>(actor, "select public.increment_vehicle_view($1)", [id]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_SCHEMA);
  await db.exec(PREVIOUS_GUARD);
  await db.exec(GUARD_TRIGGER);
  await db.exec(MIGRATION);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("izlenme sayacı: increment_vehicle_view", () => {
  it("migration test ilanlarından sonra uygulanır", () => {
    const migrations = readdirSync("supabase/migrations").sort();
    expect(migrations).toContain("20260929100000_vehicle_views.sql");
    expect(migrations.indexOf("20260929100000_vehicle_views.sql")).toBeGreaterThan(migrations.indexOf("20260928200000_test_listings.sql"));
  });

  it("misafir ve üye yayındaki ilanı tam +1 artırır, yeni sayıyı döner; diğer sayaçlar ve updated_at değişmez", async () => {
    const id = await listing();
    const before = await counters(id);
    expect(await view(anon, id)).toMatchObject({ ok: true, rows: [{ increment_vehicle_view: 1 }] });
    expect(await view(member, id)).toMatchObject({ ok: true, rows: [{ increment_vehicle_view: 2 }] });
    expect(await view(seller, id)).toMatchObject({ ok: true, rows: [{ increment_vehicle_view: 3 }] });
    const after = await counters(id);
    expect(after).toEqual({ ...before, views_count: 3 });
  });

  it("yalnızca hedef ilan artar", async () => {
    const target = await listing();
    const other = await listing();
    await view(anon, target);
    expect((await counters(target)).views_count).toBe(1);
    expect((await counters(other)).views_count).toBe(0);
  });

  it("yayında olmayan, olmayan ya da boş ilan sayılmaz (null)", async () => {
    const draft = await listing("draft");
    const sold = await listing("sold");
    expect(await view(anon, draft)).toMatchObject({ ok: true, rows: [{ increment_vehicle_view: null }] });
    expect(await view(seller, sold)).toMatchObject({ ok: true, rows: [{ increment_vehicle_view: null }] });
    expect(await view(anon, "33333333-3333-4333-8333-333333333333")).toMatchObject({ ok: true, rows: [{ increment_vehicle_view: null }] });
    expect(await view(anon, null)).toMatchObject({ ok: true, rows: [{ increment_vehicle_view: null }] });
    expect((await counters(draft)).views_count).toBe(0);
    expect((await counters(sold)).views_count).toBe(0);
  });

  it("istemci sayaca doğrudan yazamaz: satıcı, üye, misafir ve servis anahtarının yazdığı değer yok sayılır", async () => {
    const id = await listing();
    await view(anon, id);
    expect(await run(seller, "update public.vehicles set views_count = 999999 where id = $1", [id])).toMatchObject({ ok: true });
    expect(await run(seller, "update public.vehicles set views_count = views_count + 50, city = 'Bursa' where id = $1", [id])).toMatchObject({ ok: true });
    await run(member, "update public.vehicles set views_count = 5000 where id = $1", [id]);
    await run(anon, "update public.vehicles set views_count = 5000 where id = $1", [id]);
    await run(serviceRole, "update public.vehicles set views_count = 5000 where id = $1", [id]);
    const { rows } = await db.query<{ views_count: number; city: string }>("select views_count, city from public.vehicles where id = $1", [id]);
    // Satıcının şehir değişikliği geçer, sayaç 1'de kalır
    expect(rows[0]).toEqual({ views_count: 1, city: "Bursa" });
  });

  it("yeni ilan kim açarsa açsın, ne gönderirse göndersin sıfır izlenmeyle başlar", async () => {
    const viaService = await run<{ views_count: number }>(
      serviceRole,
      "insert into public.vehicles (seller_id, status, views_count) values ($1, 'active', 777) returning views_count",
      [SELLER],
    );
    expect(viaService).toMatchObject({ ok: true, rows: [{ views_count: 0 }] });
    const { rows } = await db.query<{ views_count: number }>(
      "insert into public.vehicles (seller_id, status, views_count) values ($1, 'draft', 777) returning views_count",
      [SELLER],
    );
    expect(rows[0].views_count).toBe(0);
  });

  it("diğer sayaçların koruması aynı: doğrudan yazım yok sayılır, tetikleyici içinden artış geçer, düzenleme updated_at'i yeniler", async () => {
    const id = await listing();
    const before = await counters(id);
    await run(seller, "update public.vehicles set likes_count = 9, saves_count = 9, comments_count = 9 where id = $1", [id]);
    let now = await counters(id);
    expect([now.likes_count, now.saves_count, now.comments_count]).toEqual([0, 0, 0]);
    expect(now.updated_at).not.toBe(before.updated_at);

    await db.query("insert into public.saves (vehicle_id) values ($1)", [id]);
    now = await counters(id);
    expect(now.saves_count).toBe(1);
  });

  it("işaret işlem içinde kalır: aynı işlemde artıştan sonraki doğrudan yazım yine yok sayılır", async () => {
    const id = await listing();
    await db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(seller.claims)]);
      await tx.query("select public.increment_vehicle_view($1)", [id]);
      await tx.query("update public.vehicles set views_count = 500 where id = $1", [id]);
    });
    expect((await counters(id)).views_count).toBe(1);
  });

  it("fonksiyon security definer, arama yolu boş; herkese açık yetki yalnızca anon/authenticated/service_role'de", async () => {
    const { rows } = await db.query<{ prosecdef: boolean; proconfig: string[] | null }>(
      "select prosecdef, proconfig from pg_proc where proname = 'increment_vehicle_view'",
    );
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toContain('search_path=""');
    const grants = await db.query<{ anon: boolean; authenticated: boolean; public_role: boolean }>(`
      select has_function_privilege('anon', 'public.increment_vehicle_view(uuid)', 'execute') as anon,
             has_function_privilege('authenticated', 'public.increment_vehicle_view(uuid)', 'execute') as authenticated,
             exists (
               select 1 from pg_proc p, aclexplode(p.proacl) a
               where p.proname = 'increment_vehicle_view' and a.grantee = 0
             ) as public_role
    `);
    expect(grants.rows[0]).toEqual({ anon: true, authenticated: true, public_role: false });
  });

  it("migration tekrar çalıştırılabilir", async () => {
    await expect(db.exec(MIGRATION)).resolves.toBeDefined();
    const id = await listing();
    expect(await view(anon, id)).toMatchObject({ ok: true, rows: [{ increment_vehicle_view: 1 }] });
  });
});

describe("izlenme migration'ı: kontrol çalıştırmaları", () => {
  it("koruma değiştirilmeden yalnızca fonksiyon eklenseydi artış tetikleyiciye takılırdı (sayı 0 kalırdı)", async () => {
    const control = new PGlite();
    try {
      await control.exec(BASE_SCHEMA);
      await control.exec(PREVIOUS_GUARD);
      await control.exec(GUARD_TRIGGER);
      await control.exec(MIGRATION.slice(MIGRATION.indexOf("-- 3) Artırma")));
      const { rows } = await control.query<{ id: string }>("insert into public.vehicles (seller_id, status) values ($1, 'active') returning id", [SELLER]);
      const outcome = await runOn<{ increment_vehicle_view: number | null }>(control, anon, "select public.increment_vehicle_view($1)", [rows[0].id]);
      expect(outcome).toMatchObject({ ok: true, rows: [{ increment_vehicle_view: 0 }] });
    } finally {
      await control.close();
    }
  }, 60_000);

  it("koruma beklenen gövdede değilse migration hiçbir şey uygulamaz", async () => {
    const control = new PGlite();
    try {
      await control.exec(BASE_SCHEMA);
      await control.exec(PREVIOUS_GUARD.replace("new.comments_count := old.comments_count;", ""));
      await control.exec(GUARD_TRIGGER);
      await expect(control.exec(MIGRATION)).rejects.toThrow(/beklenen gövdede değil/);
      const { rows } = await control.query("select 1 from pg_proc where proname = 'increment_vehicle_view'");
      expect(rows).toHaveLength(0);
    } finally {
      await control.close();
    }
  }, 60_000);
});
