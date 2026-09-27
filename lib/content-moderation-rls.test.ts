// Güvenlik testleri: otomatik içerik denetimi (karantina) ve temel metin filtresi.
//
// 20260928100000_vehicle_status_pending_moderation.sql ve
// 20260928100100_content_moderation.sql gerçek bir Postgres'te (PGlite) önceki
// ilan migration'larının üstüne çalıştırılır; istekler Supabase'deki gibi rol
// (set role) ve JWT claim'leriyle taklit edilir. BASE_SCHEMA, uzak veritabanından
// 2026-09-27'de okunan tanımların (sütunlar, politikalar) bu testlerle ilgili
// asgari kopyasıdır (lib/listing-rls.test.ts ile aynı temel).

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PHOTO_BUCKET, photoStoragePath } from "./listing";
import type { VehicleStatus } from "./listing-status";
import {
  LISTING_TEXT_POLICY_ERROR,
  MESSAGE_POLICY_ERROR,
  MODERATION_TERMS,
  normalizeForModeration,
  textModerationCategory,
} from "./text-moderation";

const MIGRATIONS_DIR = "supabase/migrations";
const ENUM_MIGRATION = "20260928100000_vehicle_status_pending_moderation.sql";
const CONTENT_MIGRATION = "20260928100100_content_moderation.sql";
/** Zorunlu yönetici onayı: 'pending_approval' (içerik denetimi kurallarının üstüne) */
const APPROVAL_MIGRATION = "20260928120000_vehicle_status_pending_approval.sql";
/** Uygulanma sırasıyla; son ikisi test edilen migration'lar */
const MIGRATIONS = [
  "20260925150000_set_vehicle_status_rpc.sql",
  "20260926150000_vehicle_status_rejected.sql",
  "20260926150100_moderation.sql",
  "20260926170000_harden_listing_rls.sql",
  ENUM_MIGRATION,
  CONTENT_MIGRATION,
];
const readMigration = (name: string) => readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8");

const SELLER = "11111111-1111-4111-8111-111111111111";
const BUYER = "22222222-2222-4222-8222-222222222222";

const BASE_SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                    nullif(current_setting('request.jwt.claims', true), ''))::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  insert into auth.users values ('${SELLER}'), ('${BUYER}');

  -- Supabase'in varsayılan yetkileri: public'teki yeni tablolar herkese açılır
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
    created_at timestamptz not null default now()
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
  -- Canlıdaki gibi: boşlukları kırpar (ve hız sınırı uygular); metin filtresi ondan sonra çalışır
  create function public.fn_messages_before_insert() returns trigger language plpgsql as $f$
  begin
    new.text := btrim(new.text);
    return new;
  end;
  $f$;
  create trigger trg_messages_before_insert before insert on public.messages
    for each row execute function public.fn_messages_before_insert();

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
  create policy vehicle_images_select_visible on public.vehicle_images
    for select to anon, authenticated
    using (exists (select 1 from public.vehicles v where v.id = vehicle_images.vehicle_id
                    and (v.status = 'active' or v.seller_id = auth.uid())));
  create policy vehicle_images_insert_own_vehicle on public.vehicle_images
    for insert to authenticated
    with check (exists (select 1 from public.vehicles v where v.id = vehicle_images.vehicle_id
                         and v.seller_id = (select auth.uid()))
                and image_url like ('%/vehicle-images/' || (select auth.uid())::text || '/' || vehicle_id::text || '/%'));
  create policy vehicle_images_update_own_vehicle on public.vehicle_images
    for update to authenticated
    using (exists (select 1 from public.vehicles v where v.id = vehicle_images.vehicle_id
                    and v.seller_id = (select auth.uid())))
    with check (exists (select 1 from public.vehicles v where v.id = vehicle_images.vehicle_id
                         and v.seller_id = (select auth.uid()))
                and image_url like ('%/vehicle-images/' || (select auth.uid())::text || '/' || vehicle_id::text || '/%'));
  create policy vehicle_images_delete_own_vehicle on public.vehicle_images
    for delete to authenticated
    using (exists (select 1 from public.vehicles v where v.id = vehicle_images.vehicle_id
                    and v.seller_id = (select auth.uid())));

  create function public.fn_check_vehicle_publishable() returns trigger
  language plpgsql security definer set search_path to 'public' as $f$
  begin
    return new;
  end;
  $f$;
  create trigger trg_vehicles_check_publishable
    before insert or update of status on public.vehicles
    for each row when (new.status = 'active') execute function public.fn_check_vehicle_publishable();
`;

// Uygulamanın yazdığı fotoğraf adresi (app/sell/page.tsx uploadPhotos ile aynı çağrılar)
const PROJECT_URL = /'(https:\/\/[a-z0-9]+\.supabase\.co)\/storage\/v1\/object\/public\//.exec(
  readMigration("20260926170000_harden_listing_rls.sql"),
)?.[1];
const storage = createClient(PROJECT_URL ?? "https://eksik.supabase.co", "test-anon-key", {
  auth: { persistSession: false },
}).storage;
const appPhotoUrl = (vehicleId: string, index = 0) =>
  storage.from(PHOTO_BUCKET).getPublicUrl(photoStoragePath(vehicleId, index, "image/jpeg")).data.publicUrl;

type Actor = { role: "anon" | "authenticated" | "service_role" | null; claims: Record<string, string> | null };
const seller: Actor = { role: "authenticated", claims: { role: "authenticated", sub: SELLER } };
const buyer: Actor = { role: "authenticated", claims: { role: "authenticated", sub: BUYER } };
const anon: Actor = { role: "anon", claims: { role: "anon" } };
const serviceRole: Actor = { role: "service_role", claims: { role: "service_role" } };
/** Veritabanı yöneticisi (panel, CLI): JWT yok */
const admin: Actor = { role: null, claims: null };

type Outcome = { ok: true; rows: number } | { ok: false; code: string; message: string };

async function run(db: PGlite, actor: Actor, sql: string, params: unknown[] = []): Promise<Outcome> {
  try {
    return await db.transaction(async (tx) => {
      if (actor.role) await tx.exec(`set local role ${actor.role}`);
      if (actor.claims) {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(actor.claims)]);
      }
      const result = await tx.query(sql, params);
      return { ok: true as const, rows: result.affectedRows || result.rows.length };
    });
  } catch (error) {
    const { code = "", message = "" } = error as { code?: string; message?: string };
    return { ok: false, code, message };
  }
}

type Moderation = "pending" | "approved" | "rejected";

/** Yönetici olarak ilan açar; varsayılan: işlenmiş videolu, fotoğraflı, denetim 'approved' */
async function seedVehicle(
  db: PGlite,
  status: VehicleStatus,
  { moderation = "approved", video = true }: { moderation?: Moderation; video?: boolean } = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.vehicles (seller_id, moderation_status) values ($1, $2) returning id",
    [SELLER, moderation],
  );
  const id = rows[0].id;
  await db.query("insert into public.vehicle_images (vehicle_id, image_url) values ($1, $2)", [id, appPhotoUrl(id)]);
  if (video) {
    await db.query("insert into public.videos (vehicle_id, status, hls_url) values ($1, 'ready', $2)", [
      id,
      `https://customer-x.cloudflarestream.com/${id}/manifest/video.m3u8`,
    ]);
  }
  if (status !== "draft") await db.query("update public.vehicles set status = $2 where id = $1", [id, status]);
  return id;
}

async function vehicleRow(db: PGlite, id: string) {
  const { rows } = await db.query<{
    status: VehicleStatus;
    moderation_status: Moderation;
    moderation_reason: string | null;
    description: string | null;
  }>("select status, moderation_status, moderation_reason, description from public.vehicles where id = $1", [id]);
  return rows[0];
}

let db: PGlite;
/** Migration'dan önce açılmış ilanlar (uzak veritabanındaki gibi) */
const legacy: Partial<Record<VehicleStatus, string>> = {};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_SCHEMA);
  for (const name of MIGRATIONS.slice(0, -2)) await db.exec(readMigration(name));

  for (const status of ["pending_video", "active", "archived", "sold", "rejected"] as const) {
    const { rows } = await db.query<{ id: string }>(
      "insert into public.vehicles (seller_id) values ($1) returning id",
      [SELLER],
    );
    legacy[status] = rows[0].id;
    if (status !== "pending_video") {
      await db.query("insert into public.videos (vehicle_id, status, hls_url) values ($1, 'ready', 'https://x/v.m3u8')", [
        rows[0].id,
      ]);
    }
    await db.query("update public.vehicles set status = $2 where id = $1", [rows[0].id, status]);
  }

  await db.exec(readMigration(ENUM_MIGRATION));
  await db.exec(readMigration(CONTENT_MIGRATION));
  await db.exec(readMigration(APPROVAL_MIGRATION));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("migration", () => {
  it("sırası: ilan kurallarından sonra, enum değeri ayrı ve önce", () => {
    const migrations = readdirSync(MIGRATIONS_DIR).sort();
    const positions = MIGRATIONS.map((name) => migrations.indexOf(name));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(migrations.indexOf(CONTENT_MIGRATION)).toBe(migrations.indexOf(ENUM_MIGRATION) + 1);
    expect(migrations.indexOf(APPROVAL_MIGRATION)).toBeGreaterThan(migrations.indexOf(CONTENT_MIGRATION));
  });

  it("vehicle_status'a pending_moderation eklendi", async () => {
    const { rows } = await db.query<{ values: string }>("select enum_range(null::public.vehicle_status)::text as values");
    expect(rows[0].values).toBe("{draft,pending_video,active,sold,archived,rejected,pending_moderation,pending_approval}");
  });

  it("mevcut ilanlar denetimden geçmiş sayılır; videosu bekleyen ilan denetime girer", async () => {
    expect((await vehicleRow(db, legacy.pending_video!)).moderation_status).toBe("pending");
    for (const status of ["active", "archived", "sold", "rejected"] as const) {
      expect((await vehicleRow(db, legacy[status]!)).moderation_status).toBe("approved");
    }
  });

  it("arşivdeki eski ilan yine yayına alınabilir (geriye dönük uyum)", async () => {
    expect(await run(db, seller, "update public.vehicles set status = 'active' where id = $1", [legacy.archived])).toEqual({
      ok: true,
      rows: 1,
    });
  });

  it("denetim şartı olmayan bir fotoğraf yazma politikası kalırsa hiçbir şey uygulanmaz", async () => {
    const fresh = new PGlite();
    try {
      await fresh.exec(BASE_SCHEMA);
      for (const name of MIGRATIONS.slice(0, -1)) await fresh.exec(readMigration(name));
      await fresh.exec(`create policy vehicle_images_insert_loose on public.vehicle_images for insert to authenticated
        with check (public.fn_is_vehicle_photo_url(vehicle_id, image_url))`);
      await expect(fresh.exec(readMigration(CONTENT_MIGRATION))).rejects.toThrow(/denetim şartı olmayan/);
      const { rows } = await fresh.query(
        "select 1 from information_schema.columns where table_name = 'vehicles' and column_name = 'moderation_status'",
      );
      expect(rows).toHaveLength(0);
    } finally {
      await fresh.close();
    }
  }, 30_000);
});

describe("vehicles: denetim alanlarını yalnızca sunucu yazar", () => {
  it("satıcının açtığı ilan, ne gönderirse göndersin denetim 'pending' ile açılır", async () => {
    const { rows } = await db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(seller.claims)]);
      return tx.query<{ id: string }>(
        `insert into public.vehicles (seller_id, status, moderation_status, moderation_reason, moderated_at)
         values ($1, 'pending_video', 'approved', 'manual', now()) returning id`,
        [SELLER],
      );
    });
    expect(await vehicleRow(db, rows[0].id)).toMatchObject({ moderation_status: "pending", moderation_reason: null });
  });

  it.each([
    ["moderation_status = 'approved'"],
    ["moderation_reason = 'manual'"],
    ["moderated_at = now()"],
  ])("satıcı %s yazamaz", async (assignment) => {
    const id = await seedVehicle(db, "pending_video", { moderation: "pending" });
    const outcome = await run(db, seller, `update public.vehicles set ${assignment} where id = $1`, [id]);
    expect(outcome).toMatchObject({ ok: false, code: "42501", message: "İlanın denetim bilgisi değiştirilemez." });
  });

  it("denetimden geçmemiş ilan yayına alınamaz; sahte 'approved' ile de alınamaz", async () => {
    const id = await seedVehicle(db, "archived", { moderation: "pending" });
    expect(await run(db, seller, "update public.vehicles set status = 'active' where id = $1", [id])).toMatchObject({
      ok: false,
      code: "23514",
      message: "İlan yayınlanamadı: içerik denetimi henüz tamamlanmadı.",
    });
    expect(
      await run(db, seller, "update public.vehicles set status = 'active', moderation_status = 'approved' where id = $1", [id]),
    ).toMatchObject({ ok: false });
    expect(await run(db, seller, "select public.set_vehicle_status($1, 'active')", [id])).toMatchObject({ ok: false });
    expect(await vehicleRow(db, id)).toMatchObject({ status: "archived", moderation_status: "pending" });
  });

  it("reddedilen içerikli ilan da yayına alınamaz", async () => {
    const id = await seedVehicle(db, "archived", { moderation: "rejected" });
    expect(await run(db, seller, "update public.vehicles set status = 'active' where id = $1", [id])).toMatchObject({
      ok: false,
      code: "23514",
    });
  });

  it("satıcı denetim bekleyen ilana dokunamaz ve ilanı bu duruma getiremez", async () => {
    const pending = await seedVehicle(db, "pending_moderation", { moderation: "pending" });
    for (const target of ["archived", "active", "sold", "pending_video"]) {
      expect(await run(db, seller, "update public.vehicles set status = $2 where id = $1", [pending, target])).toMatchObject({
        ok: false,
      });
    }
    const draft = await seedVehicle(db, "pending_video", { moderation: "pending" });
    expect(
      await run(db, seller, "update public.vehicles set status = 'pending_moderation' where id = $1", [draft]),
    ).toMatchObject({ ok: false });
    expect(
      await run(db, seller, "insert into public.vehicles (seller_id, status) values ($1, 'pending_moderation')", [SELLER]),
    ).toMatchObject({ ok: false });
  });

  it("servis anahtarı: karantinaya alır, onaylayıp yayına alır", async () => {
    const id = await seedVehicle(db, "pending_video", { moderation: "pending" });
    expect(
      await run(db, serviceRole, "update public.vehicles set status = 'pending_moderation' where id = $1 and status in ('draft', 'pending_video')", [id]),
    ).toEqual({ ok: true, rows: 1 });
    // Karar yazılmadan yayın yok
    expect(await run(db, serviceRole, "update public.vehicles set status = 'active' where id = $1", [id])).toMatchObject({
      ok: false,
      message: "İlan yayınlanamadı: içerik denetimi henüz tamamlanmadı.",
    });
    expect(
      await run(
        db,
        serviceRole,
        "update public.vehicles set status = 'active', moderation_status = 'approved', moderated_at = now() where id = $1",
        [id],
      ),
    ).toEqual({ ok: true, rows: 1 });
    expect(await vehicleRow(db, id)).toMatchObject({ status: "active", moderation_status: "approved" });
  });

  it("servis anahtarı: videosu işlenmemiş ilanı onaylasa da yayına alamaz", async () => {
    const id = await seedVehicle(db, "pending_moderation", { moderation: "pending", video: false });
    expect(
      await run(db, serviceRole, "update public.vehicles set status = 'active', moderation_status = 'approved' where id = $1", [id]),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/videosu henüz işlenmedi/) });
  });

  it("servis anahtarı: reddeder; satıcı reddedilen ilanı geri alamaz", async () => {
    const id = await seedVehicle(db, "pending_moderation", { moderation: "pending" });
    expect(
      await run(
        db,
        serviceRole,
        "update public.vehicles set status = 'rejected', moderation_status = 'rejected', moderation_reason = 'sexual' where id = $1",
        [id],
      ),
    ).toEqual({ ok: true, rows: 1 });
    expect(await run(db, seller, "update public.vehicles set status = 'archived' where id = $1", [id])).toMatchObject({
      ok: false,
      code: "42501",
    });
  });

  it("denetim bekleyen ilan herkese görünmez; satıcı kendisininkini görür", async () => {
    const id = await seedVehicle(db, "pending_moderation", { moderation: "pending" });
    expect(await run(db, anon, "select 1 from public.vehicles where id = $1", [id])).toEqual({ ok: true, rows: 0 });
    expect(await run(db, buyer, "select 1 from public.vehicles where id = $1", [id])).toEqual({ ok: true, rows: 0 });
    expect(await run(db, anon, "select 1 from public.videos where vehicle_id = $1", [id])).toEqual({ ok: true, rows: 0 });
    expect(
      await run(db, seller, "select moderation_status from public.vehicles where id = $1", [id]),
    ).toEqual({ ok: true, rows: 1 });
  });
});

describe("yönetici onayı bekleyen ilan ('pending_approval')", () => {
  it("herkese görünmez; satıcı kendisininkini görür", async () => {
    const id = await seedVehicle(db, "pending_approval", { moderation: "pending" });
    expect(await run(db, anon, "select 1 from public.vehicles where id = $1", [id])).toEqual({ ok: true, rows: 0 });
    expect(await run(db, buyer, "select 1 from public.vehicles where id = $1", [id])).toEqual({ ok: true, rows: 0 });
    expect(await run(db, anon, "select 1 from public.videos where vehicle_id = $1", [id])).toEqual({ ok: true, rows: 0 });
    expect(await run(db, seller, "select 1 from public.vehicles where id = $1", [id])).toEqual({ ok: true, rows: 1 });
  });

  it("satıcı ilanı yayına alamaz, geri çekemez; bu duruma da getiremez", async () => {
    const id = await seedVehicle(db, "pending_approval", { moderation: "pending" });
    for (const target of ["active", "archived", "sold", "pending_video", "pending_moderation"]) {
      expect(await run(db, seller, "update public.vehicles set status = $2 where id = $1", [id, target])).toMatchObject({
        ok: false,
      });
    }
    expect(await run(db, seller, "select public.set_vehicle_status($1, 'active')", [id])).toMatchObject({ ok: false });
    expect(
      await run(db, seller, "update public.vehicles set status = 'active', moderation_status = 'approved' where id = $1", [id]),
    ).toMatchObject({ ok: false });
    const draft = await seedVehicle(db, "pending_video", { moderation: "pending" });
    expect(
      await run(db, seller, "update public.vehicles set status = 'pending_approval' where id = $1", [draft]),
    ).toMatchObject({ ok: false });
    expect((await vehicleRow(db, id)).status).toBe("pending_approval");
  });

  it("sunucu da yönetici kararı ('approved') yazmadan yayına alamaz", async () => {
    const id = await seedVehicle(db, "pending_approval", { moderation: "pending" });
    expect(await run(db, serviceRole, "update public.vehicles set status = 'active' where id = $1", [id])).toMatchObject({
      ok: false,
      message: "İlan yayınlanamadı: içerik denetimi henüz tamamlanmadı.",
    });
    // lib/listing-moderation.ts approve (yönetici onayı): karar ve yayın tek güncellemede
    expect(
      await run(
        db,
        serviceRole,
        "update public.vehicles set status = 'active', moderation_status = 'approved', moderation_reason = 'manual' where id = $1 and status in ('pending_moderation', 'pending_approval')",
        [id],
      ),
    ).toEqual({ ok: true, rows: 1 });
  });

  it("açıklama, fotoğraf ve fotoğraf adresi kilitli", async () => {
    const id = await seedVehicle(db, "pending_approval", { moderation: "pending" });
    expect(await run(db, seller, "update public.vehicles set description = 'yeni' where id = $1", [id])).toMatchObject({
      ok: false,
      code: "23514",
    });
    expect(
      await run(db, seller, "insert into public.vehicle_images (vehicle_id, image_url) values ($1, $2)", [id, appPhotoUrl(id, 4)]),
    ).toMatchObject({ ok: false });
    expect(
      await run(db, seller, "update public.vehicle_images set image_url = $2 where vehicle_id = $1", [id, appPhotoUrl(id, 6)]),
    ).toMatchObject({ ok: false });
  });
});

describe("vehicles: ilan metni", () => {
  it("videosu beklenen ilanın açıklaması değiştirilebilir, filtreye takılan metin yazılamaz", async () => {
    const id = await seedVehicle(db, "pending_video", { moderation: "pending" });
    expect(
      await run(db, seller, "update public.vehicles set description = 'Sıkıntısız, bakımlı araç' where id = $1", [id]),
    ).toEqual({ ok: true, rows: 1 });
    expect(
      await run(db, seller, "update public.vehicles set description = 'arayan s1kt1r olsun' where id = $1", [id]),
    ).toEqual({ ok: false, code: "23514", message: LISTING_TEXT_POLICY_ERROR });
    expect((await vehicleRow(db, id)).description).toBe("Sıkıntısız, bakımlı araç");
  });

  it.each([["description"], ["city"], ["color"]])("yeni ilanda %s filtreden geçer", async (column) => {
    expect(
      await run(db, seller, `insert into public.vehicles (seller_id, status, ${column}) values ($1, 'pending_video', $2)`, [
        SELLER,
        "Satılık tabanca da var",
      ]),
    ).toEqual({ ok: false, code: "23514", message: LISTING_TEXT_POLICY_ERROR });
    expect(
      await run(db, seller, `insert into public.vehicles (seller_id, status, ${column}) values ($1, 'pending_video', $2)`, [
        SELLER,
        "İstanbul",
      ]),
    ).toEqual({ ok: true, rows: 1 });
  });

  it.each<VehicleStatus>(["pending_moderation", "active", "archived", "sold"])(
    "denetime girmiş ilanın (%s) açıklaması değişmez; diğer alanlar serbest",
    async (status) => {
      const id = await seedVehicle(db, status, { moderation: status === "pending_moderation" ? "pending" : "approved" });
      expect(await run(db, seller, "update public.vehicles set description = 'yeni metin' where id = $1", [id])).toMatchObject({
        ok: false,
        code: "23514",
        message: "İlan açıklaması içerik denetiminden sonra değiştirilemez.",
      });
      expect(await run(db, seller, "update public.vehicles set price = 42 where id = $1", [id])).toEqual({
        ok: true,
        rows: 1,
      });
    },
  );

  it("sunucu yolları metin kuralıyla kısıtlanmaz (eski kayıtlar düzenlenebilir)", async () => {
    const id = await seedVehicle(db, "active");
    expect(await run(db, admin, "update public.vehicles set description = 'aq' where id = $1", [id])).toEqual({
      ok: true,
      rows: 1,
    });
  });
});

describe("vehicle_images: fotoğraf yalnızca denetimden önce", () => {
  it.each<[VehicleStatus, boolean]>([
    ["draft", true],
    ["pending_video", true],
    ["pending_moderation", false],
    ["active", false],
    ["archived", false],
  ])("%s ilana fotoğraf ekleme: %s", async (status, allowed) => {
    const id = await seedVehicle(db, status, { moderation: status === "active" || status === "archived" ? "approved" : "pending" });
    const outcome = await run(db, seller, "insert into public.vehicle_images (vehicle_id, image_url) values ($1, $2)", [
      id,
      appPhotoUrl(id, 3),
    ]);
    expect(outcome.ok).toBe(allowed);
  });

  it("onaydan sonra fotoğraf adresi değiştirilemez", async () => {
    const id = await seedVehicle(db, "active");
    expect(
      await run(db, seller, "update public.vehicle_images set image_url = $2 where vehicle_id = $1", [id, appPhotoUrl(id, 5)]),
    ).toMatchObject({ ok: false });
  });

  it("satıcı fotoğrafını her durumda silebilir", async () => {
    const id = await seedVehicle(db, "active");
    expect(await run(db, seller, "delete from public.vehicle_images where vehicle_id = $1", [id])).toEqual({
      ok: true,
      rows: 1,
    });
  });
});

describe("messages: metin filtresi", () => {
  it("filtreye takılan mesaj yazılmaz; hata metni uygulamadakiyle aynı", async () => {
    expect(
      await run(db, buyer, "insert into public.messages (sender_id, text) values ($1, $2)", [BUYER, "  a.m.k  "]),
    ).toEqual({ ok: false, code: "23514", message: MESSAGE_POLICY_ERROR });
  });

  it.each([["Merhaba, araç hâlâ satılık mı?"], ["Sıkıntı yok, sık sık bakımı yapıldı"], ["Golf Mk 7, 2015"]])(
    "temiz mesaj gider: %s",
    async (text) => {
      expect(await run(db, buyer, "insert into public.messages (sender_id, text) values ($1, $2)", [BUYER, text])).toEqual({
        ok: true,
        rows: 1,
      });
    },
  );

  it("mesaj sonradan filtreye takılan metne çevrilemez", async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into public.messages (sender_id, text) values ($1, 'selam') returning id",
      [BUYER],
    );
    expect(await run(db, admin, "update public.messages set text = 'siktir' where id = $1", [rows[0].id])).toMatchObject({
      ok: false,
      code: "23514",
    });
  });
});

describe("katalog: kullanıcının yazdığı marka/model adı", () => {
  it("filtreye takılan ad eklenemez; kürate katalog etkilenmez", async () => {
    expect(
      await run(db, admin, "insert into public.models (name, is_user_created) values ('Orospu Çocuğu', true)"),
    ).toMatchObject({ ok: false, code: "23514", message: "Bu marka ya da model adı kullanılamaz." });
    expect(await run(db, admin, "insert into public.models (name, is_user_created) values ('Picanto', true)")).toEqual({
      ok: true,
      rows: 1,
    });
    expect(await run(db, admin, "insert into public.brands (name, is_user_created) values ('Kia', true)")).toEqual({
      ok: true,
      rows: 1,
    });
  });
});

describe("content_moderation_events: yalnızca sunucu", () => {
  it.each([[anon], [seller]])("kullanıcı okuyamaz ve yazamaz", async (actor) => {
    expect(await run(db, actor, "select * from public.content_moderation_events")).toMatchObject({
      ok: false,
      code: "42501",
    });
    expect(
      await run(
        db,
        actor,
        "insert into public.content_moderation_events (subject_type, provider, decision) values ('listing', 'x', 'safe')",
      ),
    ).toMatchObject({ ok: false, code: "42501" });
  });

  it("servis anahtarı kayıt yazar ve okur", async () => {
    expect(
      await run(
        db,
        serviceRole,
        `insert into public.content_moderation_events (subject_type, subject_id, user_id, provider, decision, reasons, scores)
         values ('listing', gen_random_uuid(), $1, 'sightengine', 'rejected', '{sexual}', '{"sexual":0.93}')`,
        [SELLER],
      ),
    ).toEqual({ ok: true, rows: 1 });
    expect(await run(db, serviceRole, "select * from public.content_moderation_events")).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------
// TS ve SQL: aynı liste, aynı sadeleştirme, aynı karar
// ---------------------------------------------------------------

/** Tekrarlanabilir rastgele metinler (mulberry32) */
function randomTexts(count: number, seed = 42): string[] {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const alphabet = [
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    ..."İIıŞşĞğÜüÖöÇçÂâÎîÛû@$",
    ..." .-_*!?,\n\t",
    "̇",
    "̧",
    "é",
    "K", // Kelvin işareti: JS toLowerCase onu "k" yapar; kural yalnızca ASCII'yi küçültmeli
    "😀",
    "ß",
  ];
  const words = MODERATION_TERMS.map((t) => t.term);
  return Array.from({ length: count }, () => {
    const parts: string[] = [];
    const length = 1 + Math.floor(next() * 6);
    for (let i = 0; i < length; i++) {
      if (next() < 0.35) {
        // Terimi bozarak ekle: büyük harf, araya nokta, tekrar harf, rakam
        let word = words[Math.floor(next() * words.length)];
        if (next() < 0.3) word = word.toUpperCase();
        if (next() < 0.3) word = [...word].join(".");
        if (next() < 0.3) word = word.replace(/i/g, "1").replace(/s/g, "5");
        if (next() < 0.3) word = word.replace(/a/g, "aaa");
        parts.push(word);
      } else {
        const size = 1 + Math.floor(next() * 8);
        parts.push(Array.from({ length: size }, () => alphabet[Math.floor(next() * alphabet.length)]).join(""));
      }
    }
    return parts.join(next() < 0.5 ? " " : "");
  });
}

const PARITY_SAMPLES = [
  "",
  "   ",
  "Sıkıntısız, sık sık bakımı yapılmış; canımı sıktı",
  "SİKTİR GİT",
  "s i k t i r",
  "s.i.k.t.i.r",
  "a.m.k",
  "@mk",
  "aq",
  "AMK 2015",
  "Golf Mk 7",
  "Kia Picanto",
  "Ford Escort",
  "esrarengiz bir renk",
  "esrar var mı",
  "öldürecek fiyat",
  "seni öldürürüm",
  "Sahte plaka",
  "Şerefsiz",
  "orrrrrospu",
  "or0spu",
  "ş̧erefsiz",
  "şerefsiz",
  "i̇bne",
  "KELVİN K",
  "emoji 😀 aq 😀",
  "1.6 dizel, 450 bin km, 2015 model",
  "silah satılık",
  "silahlı kuvvetlerden emekli",
  "Deneme Bonusu veren siteler",
  "tecavüz",
  "çıplak foto at",
  "amına koyayım",
  "amina",
  "amca",
  "ambalaj amortisör",
];

describe("TS ve SQL eşitliği", () => {
  it("terim listesi aynı ve her terim sadeleştirilmiş biçimde", async () => {
    const { rows } = await db.query<{ term: string; match_kind: string; category: string }>(
      "select term, match_kind, category from public.fn_moderation_terms() order by ord",
    );
    expect(rows.map((r) => ({ term: r.term, match: r.match_kind, category: r.category }))).toEqual(MODERATION_TERMS);
    for (const { term } of MODERATION_TERMS) expect(normalizeForModeration(term)).toBe(term);
  });

  it("sadeleştirme ve karar, örneklerde ve 600 rastgele metinde birebir aynı", async () => {
    const samples = [...PARITY_SAMPLES, ...randomTexts(600)];
    const { rows } = await db.query<{ normalized: string; category: string | null }>(
      `select public.fn_moderation_normalize(t.value) as normalized,
              public.fn_moderation_text_category(t.value) as category
         from unnest($1::text[]) with ordinality as t(value, ord)
        order by t.ord`,
      [samples],
    );
    const mismatches = samples
      .map((text, i) => ({
        text,
        ts: { normalized: normalizeForModeration(text), category: textModerationCategory(text) },
        sql: rows[i],
      }))
      .filter(({ ts, sql }) => ts.normalized !== sql.normalized || ts.category !== sql.category);
    expect(mismatches).toEqual([]);
    // Rastgele metinlerin bir kısmı gerçekten filtreye takılmalı (test anlamlı olsun)
    expect(rows.filter((r) => r.category).length).toBeGreaterThan(50);
  });
});
