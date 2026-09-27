// Güvenlik testleri: ilan tablolarına doğrudan (PostgREST üzerinden) yazan
// kullanıcı istekleri.
//
// Migration dosyaları gerçek bir Postgres'te (PGlite, WASM) çalıştırılır;
// istekler Supabase'deki gibi veritabanı rolü (set role) ve JWT claim'leri
// (request.jwt.claims) ile taklit edilir. BASE_SCHEMA, uzak veritabanından
// 2026-09-26'da okunan tanımların (tablo yetkileri, RLS politikaları,
// tetikleyiciler) bu testlerle ilgili asgari kopyasıdır.

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PHOTO_BUCKET, photoStoragePath, type VehicleInsert } from "./listing";
import { OWNER_TRANSITIONS, VEHICLE_STATUSES, type VehicleStatus } from "./listing-status";

const MIGRATIONS_DIR = "supabase/migrations";
const HARDEN_MIGRATION = "20260926170000_harden_listing_rls.sql";
/** Uygulanma sırasıyla; sonuncusu test edilen migration */
const MIGRATIONS = [
  "20260925150000_set_vehicle_status_rpc.sql",
  "20260926150000_vehicle_status_rejected.sql",
  "20260926150100_moderation.sql",
  HARDEN_MIGRATION,
];
const PENDING_MODERATION_MIGRATION = "20260928100000_vehicle_status_pending_moderation.sql";
const readMigration = (name: string) => readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8");

const SELLER = "11111111-1111-4111-8111-111111111111";
const OTHER_SELLER = "22222222-2222-4222-8222-222222222222";

const BASE_SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (id uuid primary key);
  -- Supabase'deki gibi: claim'ler PostgREST'in yazdığı request.jwt.claims'ten okunur
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                    nullif(current_setting('request.jwt.claims', true), ''))::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;

  create type public.vehicle_status as enum ('draft', 'pending_video', 'active', 'sold', 'archived');
  create table public.vehicles (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null,
    status public.vehicle_status not null default 'draft',
    price integer not null default 1
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
  grant all on all tables in schema public to anon, authenticated, service_role;

  alter table public.vehicles enable row level security;
  create policy vehicles_select_active_or_own on public.vehicles
    for select using (status = 'active' or auth.uid() = seller_id);
  create policy vehicles_insert_own on public.vehicles
    for insert with check (auth.uid() = seller_id);
  create policy vehicles_update_own on public.vehicles
    for update using (auth.uid() = seller_id);
  create policy vehicles_delete_own on public.vehicles
    for delete using (auth.uid() = seller_id);

  -- Kullanıcılar için INSERT/UPDATE politikası yok: satırları yalnızca sunucu yazar
  alter table public.videos enable row level security;
  create policy videos_select_via_vehicle on public.videos
    for select using (exists (select 1 from public.vehicles v where v.id = videos.vehicle_id
                               and (v.status = 'active' or v.seller_id = auth.uid())));
  create policy videos_delete_own_vehicle on public.videos
    for delete using (exists (select 1 from public.vehicles v where v.id = videos.vehicle_id
                               and v.seller_id = auth.uid()));

  alter table public.vehicle_images enable row level security;
  create policy vehicle_images_select_visible on public.vehicle_images
    for select to anon, authenticated
    using (exists (select 1 from public.vehicles v where v.id = vehicle_images.vehicle_id
                    and (v.status = 'active' or v.seller_id = auth.uid())));
  create policy vehicle_images_insert_own on public.vehicle_images
    for insert to authenticated
    with check (exists (select 1 from public.vehicles v where v.id = vehicle_images.vehicle_id
                         and v.seller_id = auth.uid()));
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
    if tg_op = 'UPDATE' and old.status = 'active' then
      return new;
    end if;
    if not exists (select 1 from public.vehicle_images i where i.vehicle_id = new.id)
       and not exists (select 1 from public.videos x
                        where x.vehicle_id = new.id and x.status = 'ready' and x.hls_url is not null) then
      raise exception 'İlan yayınlanamadı: en az bir fotoğraf ya da işlenmiş bir video gerekli.'
        using errcode = 'check_violation';
    end if;
    return new;
  end;
  $f$;
  create trigger trg_vehicles_check_publishable
    before insert or update of status on public.vehicles
    for each row when (new.status = 'active') execute function public.fn_check_vehicle_publishable();
`;

// Uygulamanın yazdığı adres: app/sell/page.tsx uploadPhotos ile aynı çağrılar.
// Proje adresi migration'daki sabitten gelir (SQL NEXT_PUBLIC_SUPABASE_URL'i bilemez).
const PROJECT_URL = /'(https:\/\/[a-z0-9]+\.supabase\.co)\/storage\/v1\/object\/public\//.exec(
  readMigration(HARDEN_MIGRATION),
)?.[1];
const storage = createClient(PROJECT_URL ?? "https://eksik.supabase.co", "test-anon-key", {
  auth: { persistSession: false },
}).storage;

function appPhotoUrl(vehicleId: string, index = 0, mimeType = "image/jpeg"): string {
  return storage.from(PHOTO_BUCKET).getPublicUrl(photoStoragePath(vehicleId, index, mimeType)).data.publicUrl;
}

type Actor = { role: "anon" | "authenticated" | "service_role" | null; claims: Record<string, string> | null };
const seller: Actor = { role: "authenticated", claims: { role: "authenticated", sub: SELLER } };
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

/** Temel şema + test edilen migration'dan önceki migration'lar */
async function databaseBeforeHardening(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BASE_SCHEMA);
  for (const name of MIGRATIONS.slice(0, -1)) await db.exec(readMigration(name));
  return db;
}

type VideoStatus = "pending" | "processing" | "ready" | "failed";

/**
 * Yönetici olarak (durum geçiş tablosu uygulanmaz) fotoğraflı bir ilan açar.
 * Varsayılan olarak videosu işlenmiştir; video: null → videosuz ilan.
 */
async function seedVehicle(
  db: PGlite,
  status: VehicleStatus,
  { sellerId = SELLER, video = "ready" }: { sellerId?: string; video?: VideoStatus | null } = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.vehicles (seller_id) values ($1) returning id",
    [sellerId],
  );
  const id = rows[0].id;
  await db.query("insert into public.vehicle_images (vehicle_id, image_url, is_primary) values ($1, $2, true)", [
    id,
    appPhotoUrl(id),
  ]);
  if (video) {
    await db.query("insert into public.videos (vehicle_id, status, hls_url) values ($1, $2, $3)", [
      id,
      video,
      video === "ready" ? `https://customer-x.cloudflarestream.com/${id}/manifest/video.m3u8` : null,
    ]);
  }
  if (status !== "draft") await db.query("update public.vehicles set status = $2 where id = $1", [id, status]);
  return id;
}

async function statusOf(db: PGlite, id: string): Promise<VehicleStatus | undefined> {
  const { rows } = await db.query<{ status: VehicleStatus }>("select status from public.vehicles where id = $1", [id]);
  return rows[0]?.status;
}

async function imageUrlsOf(db: PGlite, vehicleId: string): Promise<string[]> {
  const { rows } = await db.query<{ image_url: string }>(
    "select image_url from public.vehicle_images where vehicle_id = $1 order by display_order, image_url",
    [vehicleId],
  );
  return rows.map((row) => row.image_url);
}

let db: PGlite;

beforeAll(async () => {
  db = await databaseBeforeHardening();
  // Uzak veritabanındaki gibi: migration'dan önce yüklenmiş bir fotoğraf
  await seedVehicle(db, "archived");
  await db.exec(readMigration(HARDEN_MIGRATION));
  // Sonradan eklenen durum (VEHICLE_STATUSES'ta var): geçiş tablosu onu "else array[]"
  // dalıyla karşılamalı. Denetim kuralları lib/content-moderation-rls.test.ts'te.
  await db.exec(readMigration(PENDING_MODERATION_MIGRATION));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("migration sırası", () => {
  it("moderasyon migration'ından sonra uygulanır", () => {
    const migrations = readdirSync(MIGRATIONS_DIR).sort();
    const positions = MIGRATIONS.map((name) => migrations.indexOf(name));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("proje adresi migration'da tanımlı", () => {
    expect(PROJECT_URL).toMatch(/^https:\/\/[a-z0-9]{20}\.supabase\.co$/);
  });
});

describe("vehicles.status: satıcının tabloya doğrudan yazması", () => {
  const pairs = VEHICLE_STATUSES.flatMap((from) =>
    VEHICLE_STATUSES.filter((to) => to !== from).map((to) => [from, to] as const),
  );

  it.each(pairs)("%s → %s yalnızca set_vehicle_status'taki tabloya göre", async (from, to) => {
    const id = await seedVehicle(db, from);
    const outcome = await run(db, seller, "update public.vehicles set status = $2 where id = $1", [id, to]);
    const allowed = OWNER_TRANSITIONS[from].includes(to);

    expect(outcome.ok).toBe(allowed);
    expect(await statusOf(db, id)).toBe(allowed ? to : from);
  });

  it("satılmış ilanı yeniden yayına alma denemesi, uygulamanın gösterdiği hatayla reddedilir", async () => {
    const id = await seedVehicle(db, "sold");
    const outcome = await run(db, seller, "update public.vehicles set status = 'active' where id = $1", [id]);
    // lib/my-listings.ts statusErrorMessage: 23514 → veritabanının mesajı
    expect(outcome).toMatchObject({ ok: false, code: "23514", message: "Bu ilanın durumu bu şekilde değiştirilemez." });
  });

  it("durumu değişmeyen ve durum dışı kolonları değiştiren güncellemeler serbest", async () => {
    const id = await seedVehicle(db, "sold");
    expect(
      await run(db, seller, "update public.vehicles set status = 'sold', price = 5 where id = $1", [id]),
    ).toEqual({ ok: true, rows: 1 });
    expect(await run(db, seller, "update public.vehicles set price = 7 where id = $1", [id])).toEqual({
      ok: true,
      rows: 1,
    });
  });

  it("set_vehicle_status aynı kurallarla çalışmaya devam eder", async () => {
    const id = await seedVehicle(db, "active");
    expect(await run(db, seller, "select public.set_vehicle_status($1, 'sold')", [id])).toMatchObject({ ok: true });
    expect(await statusOf(db, id)).toBe("sold");
    expect(await run(db, seller, "select public.set_vehicle_status($1, 'active')", [id])).toMatchObject({ ok: false });
    expect(await statusOf(db, id)).toBe("sold");
  });

  it("JWT'de rol olmasa da authenticated rolüyle gelen istek kısıtlanır", async () => {
    const id = await seedVehicle(db, "sold");
    const noRoleClaim: Actor = { role: "authenticated", claims: { sub: SELLER } };
    expect(await run(db, noRoleClaim, "update public.vehicles set status = 'active' where id = $1", [id])).toMatchObject({
      ok: false,
    });
    expect(await statusOf(db, id)).toBe("sold");
  });

  it("başkasının ilanına dokunulamaz", async () => {
    const id = await seedVehicle(db, "archived", { sellerId: OTHER_SELLER });
    expect(await run(db, seller, "update public.vehicles set status = 'active' where id = $1", [id])).toEqual({
      ok: true,
      rows: 0,
    });
    expect(await statusOf(db, id)).toBe("archived");
  });

  it("moderasyonun kaldırdığı ilanda moderasyon tetikleyicisinin mesajı gelir", async () => {
    const id = await seedVehicle(db, "rejected");
    const outcome = await run(db, seller, "update public.vehicles set status = 'archived' where id = $1", [id]);
    expect(outcome).toMatchObject({ ok: false, code: "42501", message: expect.stringMatching(/moderasyon/) });
  });

  describe("yeni ilan", () => {
    const insertable: VehicleStatus[] = ["draft", "pending_video"];

    it.each(VEHICLE_STATUSES)("status=%s ile açma", async (status) => {
      const outcome = await run(db, seller, "insert into public.vehicles (seller_id, status) values ($1, $2)", [
        SELLER,
        status,
      ]);
      expect(outcome.ok).toBe(insertable.includes(status));
    });

    it("durum verilmeden (varsayılan: draft) açılabilir", async () => {
      expect(await run(db, seller, "insert into public.vehicles (seller_id) values ($1)", [SELLER])).toEqual({
        ok: true,
        rows: 1,
      });
    });

    it("app/sell'in yazdığı durum kabul edilir", async () => {
      // lib/listing.ts VehicleInsert.status başka bir değere dönerse tsc burada durur
      const sellStatus: VehicleInsert["status"] = "pending_video";
      expect(
        await run(db, seller, "insert into public.vehicles (seller_id, status) values ($1, $2)", [SELLER, sellStatus]),
      ).toEqual({ ok: true, rows: 1 });
    });
  });

  describe("sunucu yolları kısıtlanmaz", () => {
    // Bugün video hazır olunca ilan önce 'pending_moderation'a, denetimden sonra 'active'e
    // geçer (lib/video-activation.ts, lib/listing-moderation.ts); o kurallar
    // lib/content-moderation-rls.test.ts'te. Burada: geçiş tablosu sunucuyu kısıtlamaz.
    it("servis anahtarı: draft/pending_video → active geçiş tablosuna takılmaz", async () => {
      const id = await seedVehicle(db, "pending_video");
      const outcome = await run(
        db,
        serviceRole,
        "update public.vehicles set status = 'active' where id = $1 and status in ('draft', 'pending_video')",
        [id],
      );
      expect(outcome).toEqual({ ok: true, rows: 1 });
    });

    it("servis anahtarı: moderasyon → rejected (lib/moderation-server.ts)", async () => {
      const id = await seedVehicle(db, "active");
      expect(await run(db, serviceRole, "update public.vehicles set status = 'rejected' where id = $1", [id])).toEqual({
        ok: true,
        rows: 1,
      });
    });

    it("veritabanı yöneticisi geçiş tablosuyla sınırlı değil", async () => {
      const id = await seedVehicle(db, "sold");
      expect(await run(db, admin, "update public.vehicles set status = 'active' where id = $1", [id])).toEqual({
        ok: true,
        rows: 1,
      });
    });
  });
});

describe("yayın şartı: işlenmiş video", () => {
  const archive = "select public.set_vehicle_status($1, 'archived')";
  const publish = "select public.set_vehicle_status($1, 'active')";
  const publishDirectly = "update public.vehicles set status = 'active' where id = $1";

  it("videosu işlenmemiş ilan, geri çekip yeniden yayına alınarak yayına sokulamaz", async () => {
    const id = await seedVehicle(db, "pending_video", { video: "processing" });

    expect(await run(db, seller, archive, [id])).toMatchObject({ ok: true });
    expect(await run(db, seller, publish, [id])).toMatchObject({
      ok: false,
      code: "23514",
      message: expect.stringMatching(/video/i),
    });
    expect(await run(db, seller, publishDirectly, [id])).toMatchObject({ ok: false, code: "23514" });
    expect(await statusOf(db, id)).toBe("archived");
  });

  it("video işlenince aynı ilan yayına alınabilir", async () => {
    const id = await seedVehicle(db, "archived", { video: "processing" });
    expect(await run(db, seller, publish, [id])).toMatchObject({ ok: false });

    await db.query("update public.videos set status = 'ready', hls_url = 'https://h/v.m3u8' where vehicle_id = $1", [id]);
    expect(await run(db, seller, publish, [id])).toMatchObject({ ok: true });
    expect(await statusOf(db, id)).toBe("active");
  });

  it.each<[string, VideoStatus | null]>([
    ["video yok (yalnızca fotoğraf)", null],
    ["video yükleniyor", "pending"],
    ["video işleniyor", "processing"],
    ["video işlenemedi", "failed"],
  ])("yetmez: %s", async (_label, video) => {
    const id = await seedVehicle(db, "archived", { video });
    expect(await run(db, seller, publish, [id])).toMatchObject({ ok: false, code: "23514" });
    expect(await statusOf(db, id)).toBe("archived");
  });

  it("'ready' olsa da oynatma adresi (hls_url) olmayan video yetmez", async () => {
    const id = await seedVehicle(db, "archived", { video: null });
    await db.query("insert into public.videos (vehicle_id, status) values ($1, 'ready')", [id]);
    expect(await run(db, seller, publish, [id])).toMatchObject({ ok: false, code: "23514" });
  });

  it("servis anahtarı ve yönetici de videosu işlenmemiş ilanı yayına alamaz", async () => {
    for (const actor of [serviceRole, admin]) {
      const id = await seedVehicle(db, "pending_video", { video: "processing" });
      expect(await run(db, actor, publishDirectly, [id])).toMatchObject({ ok: false, code: "23514" });
      expect(await statusOf(db, id)).toBe("pending_video");
    }
  });

  it("satıcı videoyu kendisi 'hazır' gösteremez", async () => {
    const id = await seedVehicle(db, "archived", { video: "processing" });
    expect(
      await run(db, seller, "update public.videos set status = 'ready', hls_url = 'https://h/v.m3u8' where vehicle_id = $1", [
        id,
      ]),
    ).toEqual({ ok: true, rows: 0 });
    expect(
      await run(db, seller, "insert into public.videos (vehicle_id, status, hls_url) values ($1, 'ready', 'https://h/v.m3u8')", [
        id,
      ]),
    ).toMatchObject({ ok: false, code: "42501" });
    expect(await run(db, seller, publish, [id])).toMatchObject({ ok: false });
  });
});

describe("vehicle_images: fotoğraf adresi", () => {
  const insertImage = "insert into public.vehicle_images (vehicle_id, image_url, display_order) values ($1, $2, $3)";

  it.each(["image/jpeg", "image/png", "image/webp", "image/heic", ""])(
    "uygulamanın getPublicUrl ile ürettiği adres kabul edilir (%s)",
    async (mimeType) => {
      const id = await seedVehicle(db, "pending_video");
      const url = appPhotoUrl(id, 1, mimeType);
      expect(await run(db, seller, insertImage, [id, url, 1])).toEqual({ ok: true, rows: 1 });
      expect(await imageUrlsOf(db, id)).toContain(url);
    },
  );

  it.each([
    ["başka sunucu", (u: string) => u.replace(/^https:\/\/[^/]+/, "https://evil.example")],
    ["proje adına benzeyen sunucu", (u: string) => u.replace(".supabase.co/", ".supabase.co.evil.example/")],
    ["http", (u: string) => u.replace(/^https:/, "http:")],
    ["başka bucket", (u: string) => u.replace(`/public/${PHOTO_BUCKET}/`, "/public/vehicle-images/")],
    ["sorgu dizesi", (u: string) => `${u}?download=1`],
    ["parça (#)", (u: string) => `${u}#x`],
    ["alt klasör", (u: string) => u.replace(/\/(\d+\.\w+)$/, "/x/$1")],
    ["üst klasöre çıkış", (u: string) => u.replace(/\/(\d+\.\w+)$/, "/../$1")],
    ["sayı olmayan dosya adı", (u: string) => u.replace(/\/\d+\.(\w+)$/, "/kapak.$1")],
    ["büyük harfli uzantı", (u: string) => u.replace(/\.(\w+)$/, ".PNG")],
    ["uzantısız", (u: string) => u.replace(/\.\w+$/, "")],
  ])("reddedilir: %s", async (_label, mutate) => {
    const id = await seedVehicle(db, "pending_video");
    const before = await imageUrlsOf(db, id);
    const outcome = await run(db, seller, insertImage, [id, mutate(appPhotoUrl(id, 1)), 1]);
    expect(outcome).toMatchObject({ ok: false, code: "42501" });
    expect(await imageUrlsOf(db, id)).toEqual(before);
  });

  it("eski katı politikanın geçirdiği saldırgan adresi artık geçmez", async () => {
    const id = await seedVehicle(db, "pending_video");
    const url = `https://evil.example/vehicle-images/${SELLER}/${id}/0.png`;
    expect(await run(db, seller, insertImage, [id, url, 1])).toMatchObject({ ok: false, code: "42501" });
  });

  it("satıcı kendi ilanının adresini başka bir ilanın klasörüne yöneltemez", async () => {
    const own = await seedVehicle(db, "pending_video");
    const other = await seedVehicle(db, "active");
    expect(await run(db, seller, insertImage, [own, appPhotoUrl(other, 3), 1])).toMatchObject({ ok: false });
  });

  it("başkasının ilanına, o ilanın geçerli adresiyle bile, fotoğraf eklenemez", async () => {
    const id = await seedVehicle(db, "active", { sellerId: OTHER_SELLER });
    expect(await run(db, seller, insertImage, [id, appPhotoUrl(id, 1), 1])).toMatchObject({ ok: false });
  });

  it("anonim istek fotoğraf ekleyemez", async () => {
    const id = await seedVehicle(db, "active");
    expect(await run(db, anon, insertImage, [id, appPhotoUrl(id, 1), 1])).toMatchObject({ ok: false });
  });

  it("geçerli satırın adresi sonradan dış adrese çevrilemez; sıra ve kapak değiştirilebilir", async () => {
    const id = await seedVehicle(db, "active");
    const [url] = await imageUrlsOf(db, id);

    expect(
      await run(db, seller, "update public.vehicle_images set image_url = $2 where vehicle_id = $1", [
        id,
        "https://evil.example/0.png",
      ]),
    ).toMatchObject({ ok: false, code: "42501" });
    expect(await imageUrlsOf(db, id)).toEqual([url]);

    expect(
      await run(db, seller, "update public.vehicle_images set display_order = 2, is_primary = false where vehicle_id = $1", [
        id,
      ]),
    ).toEqual({ ok: true, rows: 1 });
  });

  it("adres denetimi olmayan yazma politikası kalmadı", async () => {
    const { rows } = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
        where schemaname = 'public' and tablename = 'vehicle_images' and cmd in ('INSERT', 'UPDATE', 'ALL')
        order by policyname`,
    );
    expect(rows.map((row) => row.policyname)).toEqual([
      "vehicle_images_insert_own_vehicle",
      "vehicle_images_update_own_vehicle",
    ]);
  });
});

describe("migration ön denetimleri: bir adım başarısız olursa hiçbir şey uygulanmaz", () => {
  async function triggerExists(database: PGlite): Promise<boolean> {
    const { rows } = await database.query("select 1 from pg_trigger where tgname = 'trg_vehicles_guard_owner_status'");
    return rows.length > 0;
  }

  it("kurala uymayan mevcut fotoğraf varsa (ör. yanlış proje adresi) durur", async () => {
    const fresh = await databaseBeforeHardening();
    try {
      const id = await seedVehicle(fresh, "draft");
      await fresh.query("insert into public.vehicle_images (vehicle_id, image_url) values ($1, $2)", [
        id,
        "https://baska-proje.supabase.co/storage/v1/object/public/vehicle-photos/x/0.png",
      ]);
      await expect(fresh.exec(readMigration(HARDEN_MIGRATION))).rejects.toThrow(/uymuyor/);
      expect(await triggerExists(fresh)).toBe(false);
    } finally {
      await fresh.close();
    }
  }, 60_000);

  it("adres denetimi olmayan başka bir yazma politikası varsa durur", async () => {
    const fresh = await databaseBeforeHardening();
    try {
      await fresh.exec(
        "create policy vehicle_images_insert_any on public.vehicle_images for insert to authenticated with check (true)",
      );
      await expect(fresh.exec(readMigration(HARDEN_MIGRATION))).rejects.toThrow(/adres denetimi olmayan/);
      expect(await triggerExists(fresh)).toBe(false);
    } finally {
      await fresh.close();
    }
  }, 60_000);
});
