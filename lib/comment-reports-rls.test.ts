// Güvenlik testleri: yorum şikayetleri (20260928180000_comment_reports.sql).
//
// Migration, gerçek reports ve yorum migration'larının üstünde gerçek bir
// Postgres'te (PGlite) çalışır; istekler Supabase'deki gibi rol (set role) ve JWT
// claim'leriyle taklit edilir. BASE_SCHEMA, lib/comments-rls.test.ts'in tabanı;
// reports taklidi yerine gerçek tablo (public.users ile) kurulur.

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = "supabase/migrations";
const COMMENT_REPORTS_MIGRATION = "20260928180000_comment_reports.sql";
/** Uygulanma sırasıyla; sonuncusu test edilen */
const MIGRATIONS = [
  "20260925150000_set_vehicle_status_rpc.sql",
  "20260925230000_reports.sql",
  "20260926150000_vehicle_status_rejected.sql",
  "20260926150100_moderation.sql",
  "20260926170000_harden_listing_rls.sql",
  "20260928100000_vehicle_status_pending_moderation.sql",
  "20260928100100_content_moderation.sql",
  "20260928120000_vehicle_status_pending_approval.sql",
  "20260928140000_moderation_event_failures.sql",
  "20260928160000_vehicle_comments.sql",
  COMMENT_REPORTS_MIGRATION,
];
const readMigration = (name: string) => readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8");

const SELLER = "11111111-1111-4111-8111-111111111111";
const BUYER = "22222222-2222-4222-8222-222222222222";
const OTHER = "66666666-6666-4666-8666-666666666666";

/** Canlıdaki fn_guard_vehicle_counters (yorum migration'ı gövdesini denetler) */
const LIVE_COUNTER_GUARD = `
  create or replace function public.fn_guard_vehicle_counters()
   returns trigger
   language plpgsql
  as $function$
  begin
    if tg_op = 'INSERT' then
      -- Yeni ilan her zaman sıfır sayaçla başlar, client ne gönderirse göndersin
      new.likes_count := 0;
      new.views_count := 0;
      new.saves_count := 0;
      return new;

    elsif tg_op = 'UPDATE' then
      new.updated_at := now();
      if pg_trigger_depth() <= 1 then
        new.likes_count := old.likes_count;
        new.views_count := old.views_count;
        new.saves_count := old.saves_count;
      end if;
      return new;
    end if;

    return null;
  end;
  $function$;
  create trigger trg_vehicles_guard_counters before insert or update on public.vehicles
    for each row execute function public.fn_guard_vehicle_counters();
`;

const BASE_SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (id uuid primary key, email_confirmed_at timestamptz);
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                    nullif(current_setting('request.jwt.claims', true), ''))::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  insert into auth.users values ('${SELLER}', now()), ('${BUYER}', now()), ('${OTHER}', now());

  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

  -- reports.reporter_id bu tabloya bağlı (canlıdaki gibi)
  create table public.users (id uuid primary key);
  insert into public.users values ('${SELLER}'), ('${BUYER}'), ('${OTHER}');

  create type public.vehicle_status as enum ('draft', 'pending_video', 'active', 'sold', 'archived');
  create table public.vehicles (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null,
    status public.vehicle_status not null default 'draft',
    price integer not null default 1,
    city text,
    color text,
    description text,
    likes_count integer not null default 0,
    views_count integer not null default 0,
    saves_count integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table public.vehicle_images (
    id uuid primary key default gen_random_uuid(),
    vehicle_id uuid not null references public.vehicles(id) on delete cascade,
    image_url text not null,
    is_primary boolean not null default false,
    display_order integer not null default 0
  );
  create type public.video_status as enum ('pending', 'processing', 'ready', 'failed');
  create table public.videos (
    id uuid primary key default gen_random_uuid(),
    vehicle_id uuid not null references public.vehicles(id) on delete cascade,
    status public.video_status not null default 'processing',
    hls_url text
  );
  create table public.brands (
    id uuid primary key default gen_random_uuid(), name text not null,
    is_user_created boolean not null default false
  );
  create table public.models (
    id uuid primary key default gen_random_uuid(), brand_id uuid, name text not null,
    is_user_created boolean not null default false
  );
  create table public.messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null default gen_random_uuid(),
    sender_id uuid not null,
    text text not null,
    created_at timestamptz not null default now()
  );

  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    username text unique,
    display_name text,
    avatar_url text,
    whatsapp_number text
  );
  alter table public.profiles enable row level security;
  insert into public.profiles (id, username) values
    ('${SELLER}', 'satici'), ('${BUYER}', 'alici'), ('${OTHER}', 'baska');

  create table public.user_blocks (
    blocker_id uuid not null references auth.users(id) on delete cascade,
    blocked_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (blocker_id, blocked_id)
  );
  alter table public.user_blocks enable row level security;

  alter table public.vehicles enable row level security;
  create policy vehicles_select_active_or_own on public.vehicles
    for select using (status = 'active' or auth.uid() = seller_id);
  create policy vehicles_update_own on public.vehicles
    for update using (auth.uid() = seller_id);

  create function public.fn_check_vehicle_publishable() returns trigger
  language plpgsql security definer set search_path to 'public' as $f$
  begin
    return new;
  end;
  $f$;
  create trigger trg_vehicles_check_publishable
    before insert or update of status on public.vehicles
    for each row when (new.status = 'active') execute function public.fn_check_vehicle_publishable();
  ${LIVE_COUNTER_GUARD}
`;

type Actor = { role: "anon" | "authenticated" | "service_role" | null; claims: Record<string, string> | null };
const as = (sub: string): Actor => ({ role: "authenticated", claims: { role: "authenticated", sub } });
const anon: Actor = { role: "anon", claims: { role: "anon" } };
const serviceRole: Actor = { role: "service_role", claims: { role: "service_role" } };

type Outcome<T = Record<string, unknown>> = { ok: true; rows: T[]; count: number } | { ok: false; code: string; message: string };

async function run<T = Record<string, unknown>>(db: PGlite, actor: Actor, sql: string, params: unknown[] = []): Promise<Outcome<T>> {
  try {
    return await db.transaction(async (tx) => {
      if (actor.role) await tx.exec(`set local role ${actor.role}`);
      if (actor.claims) await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(actor.claims)]);
      const result = await tx.query<T>(sql, params);
      return { ok: true as const, rows: result.rows, count: result.affectedRows || result.rows.length };
    });
  } catch (error) {
    const { code = "", message = "" } = error as { code?: string; message?: string };
    return { ok: false, code, message };
  }
}

let db: PGlite;

/** Yönetici olarak yayındaki ilan açar */
async function seedVehicle(sellerId = SELLER): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.vehicles (seller_id, moderation_status) values ($1, 'approved') returning id",
    [sellerId],
  );
  const id = rows[0].id;
  await db.query("insert into public.videos (vehicle_id, status, hls_url) values ($1, 'ready', 'https://x/v.m3u8')", [id]);
  await db.query("update public.vehicles set status = 'active' where id = $1", [id]);
  return id;
}

/** Sunucu (servis anahtarı) yorumu ekler: spam sınırına takılmaz */
async function seedComment(vehicleId: string, userId: string, content = "Yorum"): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.vehicle_comments (vehicle_id, user_id, content) values ($1, $2, $3) returning id",
    [vehicleId, userId, content],
  );
  return rows[0].id;
}

/** /api/reports'un yaptığı gibi: servis anahtarıyla bildirim */
const report = (values: { vehicleId: string; commentId?: string | null; reporterId?: string | null; reason: string }) =>
  run<{ id: string; vehicle_id: string; comment_id: string | null }>(
    db,
    serviceRole,
    "insert into public.reports (vehicle_id, comment_id, reporter_id, reason) values ($1, $2, $3, $4) returning id, vehicle_id, comment_id",
    [values.vehicleId, values.commentId ?? null, values.reporterId ?? null, values.reason],
  );

const reportsOf = async (commentId: string) =>
  (await db.query("select id from public.reports where comment_id = $1", [commentId])).rows.length;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_SCHEMA);
  for (const name of MIGRATIONS) await db.exec(readMigration(name));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("migration", () => {
  it("sırası: yorum migration'ından sonra, en son", () => {
    const migrations = readdirSync(MIGRATIONS_DIR).sort();
    const positions = MIGRATIONS.map((name) => migrations.indexOf(name));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(migrations.at(-1)).toBe(COMMENT_REPORTS_MIGRATION);
  });

  it("mevcut ilan bildirimleri kısıtlara uyar: migration eski satırlarla da uygulanır", async () => {
    const fresh = new PGlite();
    try {
      await fresh.exec(BASE_SCHEMA);
      for (const name of MIGRATIONS.slice(0, -1)) await fresh.exec(readMigration(name));
      const { rows } = await fresh.query<{ id: string }>(
        `insert into public.vehicles (seller_id) values ('${SELLER}') returning id`,
      );
      await fresh.query(
        `insert into public.reports (vehicle_id, reporter_id, reason, status) values ($1, '${BUYER}', 'sold', 'dismissed'), ($1, null, 'fraud', 'open')`,
        [rows[0].id],
      );
      await fresh.exec(readMigration(COMMENT_REPORTS_MIGRATION));
      const after = await fresh.query("select reason, comment_id from public.reports order by reason");
      expect(after.rows).toEqual([
        { reason: "fraud", comment_id: null },
        { reason: "sold", comment_id: null },
      ]);
    } finally {
      await fresh.close();
    }
  }, 60_000);
});

describe("yorum şikayeti kaydı", () => {
  it("ilan kimliği yorumdan yazılır; istemcinin gönderdiği ilan yok sayılır", async () => {
    const v = await seedVehicle();
    const decoy = await seedVehicle();
    const c = await seedComment(v, BUYER);
    const result = await report({ vehicleId: decoy, commentId: c, reporterId: OTHER, reason: "harassment" });
    expect(result).toMatchObject({ ok: true, rows: [{ vehicle_id: v, comment_id: c }] });
  });

  it("neden, bildirimin türüne göre: yorum nedenleri ilanda, ilan nedenleri yorumda geçmez", async () => {
    const v = await seedVehicle();
    const c = await seedComment(v, BUYER);
    for (const reason of ["harassment", "hate", "sexual", "spam", "fraud", "other"]) {
      expect(await report({ vehicleId: v, commentId: c, reason })).toMatchObject({ ok: true });
    }
    for (const reason of ["sold", "wrong_info", "inappropriate", "küfür"]) {
      expect(await report({ vehicleId: v, commentId: c, reason })).toMatchObject({ ok: false, code: "23514" });
    }
    for (const reason of ["harassment", "hate", "sexual"]) {
      expect(await report({ vehicleId: v, reason })).toMatchObject({ ok: false, code: "23514" });
    }
    expect(await report({ vehicleId: v, reason: "sold" })).toMatchObject({ ok: true });
  });

  it("giriş yapmış kullanıcı aynı yorumu bir kez bildirir; misafir bildirimleri sayılmaz", async () => {
    const v = await seedVehicle();
    const c = await seedComment(v, BUYER);
    expect(await report({ vehicleId: v, commentId: c, reporterId: OTHER, reason: "spam" })).toMatchObject({ ok: true });
    expect(await report({ vehicleId: v, commentId: c, reporterId: OTHER, reason: "hate" })).toMatchObject({
      ok: false,
      code: "23505",
    });
    expect(await report({ vehicleId: v, commentId: c, reason: "spam" })).toMatchObject({ ok: true });
    expect(await report({ vehicleId: v, commentId: c, reason: "spam" })).toMatchObject({ ok: true });
    expect(await reportsOf(c)).toBe(3);
  });

  it("yorum bildirmek ilanı ya da aynı ilandaki başka yorumu bildirmeyi engellemez; ilan kuralı aynı", async () => {
    const v = await seedVehicle();
    const first = await seedComment(v, BUYER, "Bir");
    const second = await seedComment(v, SELLER, "İki");
    expect(await report({ vehicleId: v, commentId: first, reporterId: OTHER, reason: "spam" })).toMatchObject({ ok: true });
    expect(await report({ vehicleId: v, commentId: second, reporterId: OTHER, reason: "spam" })).toMatchObject({ ok: true });
    expect(await report({ vehicleId: v, reporterId: OTHER, reason: "fraud" })).toMatchObject({ ok: true });
    // İlanı ikinci kez bildirmek yine tekrar sayılır
    expect(await report({ vehicleId: v, reporterId: OTHER, reason: "spam" })).toMatchObject({ ok: false, code: "23505" });
  });

  it("kişi kendi yorumunu şikayet edemez", async () => {
    const v = await seedVehicle();
    const c = await seedComment(v, BUYER);
    expect(await report({ vehicleId: v, commentId: c, reporterId: BUYER, reason: "spam" })).toEqual({
      ok: false,
      code: "23514",
      message: "Kendi yorumunu şikayet edemezsin.",
    });
    // Satıcı ilanındaki başkasının yorumunu şikayet edebilir
    expect(await report({ vehicleId: v, commentId: c, reporterId: SELLER, reason: "harassment" })).toMatchObject({ ok: true });
  });

  it("olmayan yorum şikayet edilemez", async () => {
    const v = await seedVehicle();
    expect(
      await report({ vehicleId: v, commentId: "99999999-9999-4999-8999-999999999999", reason: "spam" }),
    ).toMatchObject({ ok: false, code: "23503" });
  });

  it("bildirimin yorumu değiştirilirse ilan yeniden yorumdan okunur", async () => {
    const v1 = await seedVehicle();
    const v2 = await seedVehicle();
    const c1 = await seedComment(v1, BUYER);
    const c2 = await seedComment(v2, BUYER);
    const created = await report({ vehicleId: v1, commentId: c1, reason: "spam" });
    const id = created.ok ? created.rows[0].id : "";
    await db.query("update public.reports set comment_id = $2 where id = $1", [id, c2]);
    const { rows } = await db.query("select vehicle_id from public.reports where id = $1", [id]);
    expect(rows).toEqual([{ vehicle_id: v2 }]);
  });
});

describe("silme (CASCADE)", () => {
  it("yorum silinince şikayetleri de gider; ilan bildirimleri kalır", async () => {
    const v = await seedVehicle();
    const c = await seedComment(v, BUYER);
    await report({ vehicleId: v, commentId: c, reporterId: OTHER, reason: "harassment" });
    await report({ vehicleId: v, reporterId: OTHER, reason: "fraud" });
    expect(await reportsOf(c)).toBe(1);

    // Yazar kendi oturumuyla siler (RLS)
    expect(await run(db, as(BUYER), "delete from public.vehicle_comments where id = $1", [c])).toMatchObject({ ok: true, count: 1 });
    expect(await reportsOf(c)).toBe(0);
    const { rows } = await db.query("select reason from public.reports where vehicle_id = $1", [v]);
    expect(rows).toEqual([{ reason: "fraud" }]);
  });

  it("ilan silinince yorumları ve bütün bildirimleri gider", async () => {
    const v = await seedVehicle();
    const c = await seedComment(v, BUYER);
    await report({ vehicleId: v, commentId: c, reason: "spam" });
    await report({ vehicleId: v, reason: "spam" });
    await db.query("delete from public.vehicles where id = $1", [v]);
    const { rows } = await db.query("select 1 from public.reports where vehicle_id = $1", [v]);
    expect(rows).toEqual([]);
  });
});

describe("erişim: tarayıcıdan okuma ve yazma yok", () => {
  it("misafir ve üye bildirimleri okuyamaz, ekleyemez, değiştiremez", async () => {
    const v = await seedVehicle();
    const c = await seedComment(v, BUYER);
    await report({ vehicleId: v, commentId: c, reporterId: OTHER, reason: "spam" });

    for (const actor of [anon, as(OTHER), as(SELLER)]) {
      expect(await run(db, actor, "select id from public.reports where comment_id = $1", [c])).toMatchObject({ ok: true, count: 0 });
      expect(
        await run(db, actor, "insert into public.reports (vehicle_id, comment_id, reason) values ($1, $2, 'spam')", [v, c]),
      ).toMatchObject({ ok: false, code: "42501" });
      expect(await run(db, actor, "update public.reports set status = 'dismissed' where comment_id = $1", [c])).toMatchObject({
        ok: true,
        count: 0,
      });
    }
    expect(await reportsOf(c)).toBe(1);
  });
});
