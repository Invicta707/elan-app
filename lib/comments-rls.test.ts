// Güvenlik testleri: ilan yorumları (20260928160000_vehicle_comments.sql).
//
// Migration, önceki ilan ve içerik denetimi migration'larının üstünde gerçek bir
// Postgres'te (PGlite) çalışır; istekler Supabase'deki gibi rol (set role) ve JWT
// claim'leriyle taklit edilir. BASE_SCHEMA, lib/content-moderation-rls.test.ts'in
// tabanı + canlıdan okunan fn_guard_vehicle_counters (panelden kurulmuş, migration'da
// yok), profiles ve user_blocks'un asgari kopyası.

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMMENT_POLICY_ERROR, commentPolicyError } from "./text-moderation";

const MIGRATIONS_DIR = "supabase/migrations";
const COMMENTS_MIGRATION = "20260928160000_vehicle_comments.sql";
/** Uygulanma sırasıyla; sonuncusu test edilen */
const MIGRATIONS = [
  "20260925150000_set_vehicle_status_rpc.sql",
  "20260926150000_vehicle_status_rejected.sql",
  "20260926150100_moderation.sql",
  "20260926170000_harden_listing_rls.sql",
  "20260928100000_vehicle_status_pending_moderation.sql",
  "20260928100100_content_moderation.sql",
  "20260928120000_vehicle_status_pending_approval.sql",
  "20260928140000_moderation_event_failures.sql",
  COMMENTS_MIGRATION,
];
const readMigration = (name: string) => readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8");

const SELLER = "11111111-1111-4111-8111-111111111111";
const BUYER = "22222222-2222-4222-8222-222222222222";
const NO_NAME = "33333333-3333-4333-8333-333333333333";
const UNCONFIRMED = "44444444-4444-4444-8444-444444444444";
const BLOCKED = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";

/** Canlıdaki fn_guard_vehicle_counters (2026-09-28, pg_get_functiondef ile okundu) */
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
  insert into auth.users values
    ('${SELLER}', now()), ('${BUYER}', now()), ('${NO_NAME}', now()),
    ('${UNCONFIRMED}', null), ('${BLOCKED}', now()), ('${OTHER}', now());

  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

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
  create table public.reports (id uuid primary key default gen_random_uuid());
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
  create policy profiles_select_own on public.profiles for select using (id = auth.uid());
  insert into public.profiles (id, username, display_name, avatar_url, whatsapp_number) values
    ('${SELLER}', 'satici', 'Satıcı Bey', 'https://x/a.webp', '905551112233'),
    ('${BUYER}', 'alici', null, null, '905559998877'),
    ('${NO_NAME}', null, 'Adsız', null, null),
    ('${UNCONFIRMED}', 'onaysiz', null, null, null),
    ('${BLOCKED}', 'engelli', null, null, null),
    ('${OTHER}', 'baska', null, null, null);

  create table public.user_blocks (
    blocker_id uuid not null references auth.users(id) on delete cascade,
    blocked_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (blocker_id, blocked_id),
    check (blocker_id <> blocked_id)
  );
  alter table public.user_blocks enable row level security;
  create policy user_blocks_own on public.user_blocks for all using (blocker_id = auth.uid());

  alter table public.vehicles enable row level security;
  create policy vehicles_select_active_or_own on public.vehicles
    for select using (status = 'active' or auth.uid() = seller_id);
  create policy vehicles_insert_own on public.vehicles
    for insert with check (auth.uid() = seller_id);
  create policy vehicles_update_own on public.vehicles
    for update using (auth.uid() = seller_id);
  create policy vehicles_delete_own on public.vehicles
    for delete using (auth.uid() = seller_id);

  alter table public.videos enable row level security;
  create policy videos_select_via_vehicle on public.videos
    for select using (exists (select 1 from public.vehicles v where v.id = videos.vehicle_id
                               and (v.status = 'active' or v.seller_id = auth.uid())));
  alter table public.vehicle_images enable row level security;

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
const seller = as(SELLER);
const buyer = as(BUYER);
const other = as(OTHER);
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

const comment = (actor: Actor, vehicleId: string, content: string) =>
  run(db, actor, "insert into public.vehicle_comments (vehicle_id, content) values ($1, $2) returning id, user_id, content, created_at", [
    vehicleId,
    content,
  ]);

/** Eklenen satırın kimliği (başarısızsa boş) */
const idOf = (outcome: Outcome) => (outcome.ok ? String(outcome.rows[0]?.id ?? "") : "");

async function commentsCount(vehicleId: string): Promise<number> {
  const { rows } = await db.query<{ comments_count: number }>("select comments_count from public.vehicles where id = $1", [vehicleId]);
  return rows[0]?.comments_count ?? -1;
}

/** Yönetici olarak ilan açar: işlenmiş videolu, denetimi onaylı, istenen durumda */
async function seedVehicle(status: "active" | "archived" = "active", sellerId = SELLER): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.vehicles (seller_id, moderation_status) values ($1, 'approved') returning id",
    [sellerId],
  );
  const id = rows[0].id;
  await db.query("insert into public.videos (vehicle_id, status, hls_url) values ($1, 'ready', 'https://x/v.m3u8')", [id]);
  await db.query("update public.vehicles set status = 'active' where id = $1", [id]);
  if (status !== "active") await db.query("update public.vehicles set status = $2 where id = $1", [id, status]);
  return id;
}

/** Spam sınırını geçmek için: kullanıcının yorumlarını geçmişe al */
const ageComments = (userId: string, seconds = 120) =>
  db.query(`update public.vehicle_comments set created_at = now() - interval '${seconds} seconds' where user_id = $1`, [userId]);

let db: PGlite;
let active: string;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_SCHEMA);
  for (const name of MIGRATIONS) await db.exec(readMigration(name));
  active = await seedVehicle();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("migration", () => {
  it("sırası: içerik denetimi ve failures'dan sonra, en son", () => {
    const migrations = readdirSync(MIGRATIONS_DIR).sort();
    const positions = MIGRATIONS.map((name) => migrations.indexOf(name));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("canlıdaki sayaç koruması beklenenden farklıysa hiçbir şey uygulanmaz", async () => {
    const fresh = new PGlite();
    try {
      await fresh.exec(BASE_SCHEMA.replace("new.saves_count := old.saves_count;", "null;"));
      for (const name of MIGRATIONS.slice(0, -1)) await fresh.exec(readMigration(name));
      await expect(fresh.exec(readMigration(COMMENTS_MIGRATION))).rejects.toThrow(/beklenen gövdede değil/);
      const { rows } = await fresh.query("select to_regclass('public.vehicle_comments') as t");
      expect(rows).toEqual([{ t: null }]);
    } finally {
      await fresh.close();
    }
  }, 60_000);
});

describe("yazma kuralları", () => {
  it("onaylı, kullanıcı adlı üye yayındaki ilana yazar; metin kırpılır, zaman ve yazar sunucunun, sayaç artar", async () => {
    const before = await commentsCount(active);
    const result = await comment(buyer, active, "   Araç hâlâ satılık mı?  ");
    expect(result).toMatchObject({ ok: true, count: 1 });
    const row = result.ok ? result.rows[0] : null;
    expect(row).toMatchObject({ user_id: BUYER, content: "Araç hâlâ satılık mı?" });
    expect(await commentsCount(active)).toBe(before + 1);
  });

  it("misafir yazamaz (yetki yok)", async () => {
    expect(await comment(anon, active, "merhaba")).toMatchObject({ ok: false, code: "42501" });
  });

  it.each([
    ["e-postası onaysız", UNCONFIRMED, "email_unconfirmed"],
    ["kullanıcı adı yok", NO_NAME, "username_required"],
  ])("%s: yazamaz; neden yardımcıdan okunur", async (_label, userId, reason) => {
    const v = await seedVehicle();
    expect(await comment(as(userId), v, "Merhaba")).toMatchObject({ ok: false, code: "42501" });
    const why = await run<{ r: string }>(db, as(userId), "select public.fn_comment_block_reason($1) as r", [v]);
    expect(why).toMatchObject({ ok: true, rows: [{ r: reason }] });
  });

  it("yayında olmayan ilana yazılamaz (satıcı bile)", async () => {
    const archived = await seedVehicle("archived");
    expect(await comment(buyer, archived, "Merhaba")).toMatchObject({ ok: false, code: "42501" });
    expect(await comment(seller, archived, "Merhaba")).toMatchObject({ ok: false, code: "42501" });
    expect(await run(db, buyer, "select public.fn_comment_block_reason($1) as r", [archived])).toMatchObject({
      rows: [{ r: "listing_unavailable" }],
    });
  });

  it("satıcıyla arasında engel varsa (iki yönden) yazılamaz", async () => {
    const v = await seedVehicle();
    await db.query("insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [SELLER, BLOCKED]);
    expect(await comment(as(BLOCKED), v, "Merhaba")).toMatchObject({ ok: false, code: "42501" });
    expect(await run(db, as(BLOCKED), "select public.fn_comment_block_reason($1) as r", [v])).toMatchObject({
      rows: [{ r: "blocked" }],
    });

    const v2 = await seedVehicle("active", OTHER);
    await db.query("insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [BUYER, OTHER]);
    expect(await comment(buyer, v2, "Merhaba")).toMatchObject({ ok: false, code: "42501" });
    await db.query("delete from public.user_blocks where blocker_id = $1 and blocked_id = $2", [BUYER, OTHER]);
  });

  it("başkası adına yazılamaz; zaman damgası ve kimlik gönderilemez", async () => {
    const v = await seedVehicle();
    expect(
      await run(db, buyer, "insert into public.vehicle_comments (vehicle_id, user_id, content) values ($1, $2, 'sahte')", [v, SELLER]),
    ).toMatchObject({ ok: false, code: "42501" });
    expect(
      await run(db, other, "insert into public.vehicle_comments (vehicle_id, content, created_at) values ($1, 'x', now() - interval '1 day')", [v]),
    ).toMatchObject({ ok: false, code: "42501" });
  });

  it("satıcı kendi ilanına yazabilir (soruları yanıtlar)", async () => {
    const v = await seedVehicle();
    expect(await comment(seller, v, "Evet, satılık.")).toMatchObject({ ok: true });
  });

  it("metin filtresi veritabanında: kurala aykırı yorum yazılmaz; mesaj TS ile birebir", async () => {
    const v = await seedVehicle();
    expect(await comment(other, v, "s1kt1r git")).toEqual({ ok: false, code: "23514", message: COMMENT_POLICY_ERROR });
    expect(commentPolicyError("s1kt1r git")).toBe(COMMENT_POLICY_ERROR);
    // Kısa kök yalnızca tam sözcük: olağan metin geçer
    expect(await comment(other, v, "Sıkıntısız mı, Golf Mk 7 mi?")).toMatchObject({ ok: true });
    expect(commentPolicyError("Sıkıntısız mı, Golf Mk 7 mi?")).toBeNull();
  });

  it("uzunluk: boş ya da yalnızca boşluk ve 500'den uzun reddedilir; 500 geçer", async () => {
    const v = await seedVehicle();
    expect(await comment(as(OTHER), v, "   ")).toMatchObject({ ok: false, code: "23514" });
    expect(await comment(as(OTHER), v, "a".repeat(501))).toMatchObject({ ok: false, code: "23514" });
    expect(await comment(as(OTHER), v, "a".repeat(500))).toMatchObject({ ok: true });
  });

  it("düzenleme yok: yazar kendi yorumunu değiştiremez", async () => {
    const v = await seedVehicle();
    await ageComments(BUYER);
    const created = await comment(buyer, v, "İlk hali");
    const id = idOf(created);
    expect(await run(db, buyer, "update public.vehicle_comments set content = 'sonradan' where id = $1", [id])).toMatchObject({
      ok: false,
      code: "42501",
    });
  });
});

describe("spam sınırı (PT429 → HTTP 429)", () => {
  it("aynı ilana 10 saniyede bir yorum", async () => {
    const v = await seedVehicle();
    await ageComments(OTHER);
    expect(await comment(other, v, "Bir")).toMatchObject({ ok: true });
    expect(await comment(other, v, "İki")).toMatchObject({ ok: false, code: "PT429" });
    // Başka ilana hemen yazılabilir
    expect(await comment(other, await seedVehicle(), "Üç")).toMatchObject({ ok: true });
    // 10 saniye geçince aynı ilana da
    await ageComments(OTHER, 11);
    expect(await comment(other, v, "Dört")).toMatchObject({ ok: true });
  });

  it("toplamda dakikada 10 yorum", async () => {
    await ageComments(BUYER);
    const vehicles = await Promise.all(Array.from({ length: 11 }, () => seedVehicle()));
    for (const v of vehicles.slice(0, 10)) {
      await db.query("insert into public.vehicle_comments (vehicle_id, user_id, content) values ($1, $2, 'sunucudan')", [v, BUYER]);
    }
    expect(await comment(buyer, vehicles[10], "on birinci")).toMatchObject({ ok: false, code: "PT429" });
  });

  it("sunucu (servis anahtarı) sınırlanmaz", async () => {
    const v = await seedVehicle();
    for (const text of ["a", "b"]) {
      expect(
        await run(db, serviceRole, "insert into public.vehicle_comments (vehicle_id, user_id, content) values ($1, $2, $3)", [v, SELLER, text]),
      ).toMatchObject({ ok: true });
    }
  });
});

describe("silme", () => {
  it("yazar kendi yorumunu siler; sayaç düşer", async () => {
    const v = await seedVehicle();
    await ageComments(OTHER);
    const id = idOf(await comment(other, v, "Silinecek"));
    expect(await commentsCount(v)).toBe(1);
    expect(await run(db, other, "delete from public.vehicle_comments where id = $1", [id])).toMatchObject({ ok: true, count: 1 });
    expect(await commentsCount(v)).toBe(0);
  });

  it("ilan sahibi ilanındaki yorumu siler; üçüncü kişi silemez; misafirin yetkisi yok", async () => {
    const v = await seedVehicle();
    await ageComments(BUYER);
    const id = idOf(await comment(buyer, v, "Satıcı silebilir"));
    expect(await run(db, other, "delete from public.vehicle_comments where id = $1", [id])).toMatchObject({ ok: true, count: 0 });
    expect(await run(db, anon, "delete from public.vehicle_comments where id = $1", [id])).toMatchObject({ ok: false, code: "42501" });
    expect(await commentsCount(v)).toBe(1);
    expect(await run(db, seller, "delete from public.vehicle_comments where id = $1", [id])).toMatchObject({ ok: true, count: 1 });
    expect(await commentsCount(v)).toBe(0);
  });

  it("ilan silinince yorumları da gider (CASCADE); sayaç tetikleyicisi hata vermez", async () => {
    const v = await seedVehicle();
    await ageComments(BUYER);
    await comment(buyer, v, "Kalmayacak");
    await db.query("delete from public.vehicles where id = $1", [v]);
    const { rows } = await db.query("select 1 from public.vehicle_comments where vehicle_id = $1", [v]);
    expect(rows).toEqual([]);
  });
});

describe("sayaç koruması", () => {
  it("satıcı ve servis anahtarı comments_count'u doğrudan değiştiremez (tetikleyici dışında)", async () => {
    const v = await seedVehicle();
    await ageComments(BUYER);
    await comment(buyer, v, "Tek yorum");
    await run(db, seller, "update public.vehicles set comments_count = 999 where id = $1", [v]);
    await run(db, serviceRole, "update public.vehicles set comments_count = 999 where id = $1", [v]);
    expect(await commentsCount(v)).toBe(1);
  });

  it("yeni ilan sıfır sayaçla açılır", async () => {
    const { rows } = await db.query<{ comments_count: number }>(
      "insert into public.vehicles (seller_id, comments_count) values ($1, 55) returning comments_count",
      [SELLER],
    );
    expect(rows[0].comments_count).toBe(0);
  });
});

describe("okuma", () => {
  let v: string;
  beforeAll(async () => {
    v = await seedVehicle();
    await ageComments(BUYER);
    await ageComments(SELLER);
    await comment(buyer, v, "Alıcının sorusu");
    await comment(seller, v, "Satıcının yanıtı");
  });

  it("misafir yayındaki ilanın yorumlarını okur; ilan yayından kalkınca göremez, satıcı ve yazar görür", async () => {
    const archived = await seedVehicle();
    await ageComments(BUYER);
    await comment(buyer, archived, "Arşivde kalacak");
    const select = "select content from public.vehicle_comments where vehicle_id = $1";
    expect(await run(db, anon, select, [archived])).toMatchObject({ ok: true, count: 1 });
    await db.query("update public.vehicles set status = 'archived' where id = $1", [archived]);
    expect(await run(db, anon, select, [archived])).toMatchObject({ ok: true, count: 0 });
    expect(await run(db, other, select, [archived])).toMatchObject({ ok: true, count: 0 });
    expect(await run(db, seller, select, [archived])).toMatchObject({ ok: true, count: 1 });
    expect(await run(db, buyer, select, [archived])).toMatchObject({ ok: true, count: 1 });
  });

  type Listed = {
    total: number;
    comments: { id: string; user_id: string; content: string; created_at: string; username: string | null; display_name: string | null; avatar_url: string | null; is_seller: boolean; is_mine: boolean; can_delete: boolean }[];
  } | null;
  const list = async (actor: Actor, vehicleId: string, limit = 20, before: string | null = null, beforeId: string | null = null) => {
    const result = await run<{ r: Listed }>(db, actor, "select public.list_vehicle_comments($1, $2, $3, $4) as r", [vehicleId, limit, before, beforeId]);
    if (!result.ok) throw new Error(result.message);
    return result.rows[0].r;
  };

  it("list_vehicle_comments: en yenisi önce, yazarın herkese açık yüzü; numara asla dönmez", async () => {
    const page = await list(anon, v);
    expect(page?.total).toBe(2);
    expect(page?.comments.map((c) => c.content)).toEqual(["Satıcının yanıtı", "Alıcının sorusu"]);
    expect(page?.comments[0]).toMatchObject({ username: "satici", display_name: "Satıcı Bey", avatar_url: "https://x/a.webp", is_seller: true });
    expect(page?.comments[1]).toMatchObject({ username: "alici", is_seller: false, is_mine: false, can_delete: false });
    expect(JSON.stringify(page)).not.toContain("9055");
  });

  it("silme hakkı: yazar kendi yorumunu, satıcı hepsini", async () => {
    const asBuyer = await list(buyer, v);
    expect(asBuyer?.comments.map((c) => [c.content, c.is_mine, c.can_delete])).toEqual([
      ["Satıcının yanıtı", false, false],
      ["Alıcının sorusu", true, true],
    ]);
    const asSeller = await list(seller, v);
    expect(asSeller?.comments.every((c) => c.can_delete)).toBe(true);
  });

  it("imleçli sayfalama; sınır 1–50", async () => {
    const first = await list(anon, v, 1);
    expect(first?.comments).toHaveLength(1);
    const last = first!.comments[0];
    const second = await list(anon, v, 1, last.created_at, last.id);
    expect(second?.comments.map((c) => c.content)).toEqual(["Alıcının sorusu"]);
    const third = await list(anon, v, 1, second!.comments[0].created_at, second!.comments[0].id);
    expect(third?.comments).toEqual([]);
    expect((await list(anon, v, 0))?.comments).toHaveLength(1);
    expect((await list(anon, v, 500))?.comments).toHaveLength(2);
  });

  it("görünmeyen ilan null; engellediğin kişinin yorumunu görmezsin", async () => {
    const archived = await seedVehicle("archived");
    expect(await list(anon, archived)).toBeNull();
    expect(await list(seller, archived)).toMatchObject({ total: 0, comments: [] });

    await db.query("insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [OTHER, BUYER]);
    expect((await list(other, v))?.comments.map((c) => c.content)).toEqual(["Satıcının yanıtı"]);
    await db.query("delete from public.user_blocks where blocker_id = $1", [OTHER]);
  });
});

describe("denetim kaydı", () => {
  it("content_moderation_events yorum kararını kabul eder", async () => {
    expect(
      await run(db, serviceRole, "insert into public.content_moderation_events (subject_type, provider, decision) values ('comment', 'local', 'rejected')"),
    ).toMatchObject({ ok: true });
  });
});
