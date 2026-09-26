// Güvenlik testleri: vehicle-photos bucket'ına yükleme.
//
// 20260926180000_vehicle_photos_storage_limits.sql gerçek bir Postgres'te
// (PGlite) çalıştırılır. storage şeması, Supabase'deki tabloların bu testle
// ilgili asgari kopyasıdır. INSERT politikası, panelden kurulacak ifadenin
// aynısıdır (migration storage.objects politikalarını değiştiremiyor).
// Dosya boyutu ve MIME sınırını Storage API uygular; burada bucket'a yazılan
// değerlerin istemcidekiyle aynı olduğu sınanır.

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_PHOTOS, MAX_PHOTO_BYTES, PHOTO_BUCKET, PHOTO_MIME_TYPES, photoStoragePath } from "./listing";
import type { VehicleStatus } from "./listing-status";

const MIGRATION = readFileSync("supabase/migrations/20260926180000_vehicle_photos_storage_limits.sql", "utf8");

const SELLER = "11111111-1111-4111-8111-111111111111";
const OTHER_SELLER = "22222222-2222-4222-8222-222222222222";

const BASE_SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;

  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true), '')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;

  create type public.vehicle_status as enum ('draft', 'pending_video', 'active', 'sold', 'archived', 'rejected');
  create table public.vehicles (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null,
    status public.vehicle_status not null default 'draft'
  );
  alter table public.vehicles enable row level security;

  create schema storage;
  create table storage.buckets (
    id text primary key,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text not null
  );
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant insert on storage.objects to anon, authenticated;
  insert into storage.buckets (id, public) values ('vehicle-photos', true), ('vehicle-images', true);
`;

// Panelde INSERT politikasına yazılacak ifade (bkz. migration yorumu)
const DASHBOARD_POLICY = `
  create policy "Authenticated users can upload vehicle photos" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'vehicle-photos' and public.fn_can_upload_vehicle_photo(name));
`;

type Actor = { role: "anon" | "authenticated"; claims: Record<string, string> };
const seller: Actor = { role: "authenticated", claims: { role: "authenticated", sub: SELLER } };
const otherSeller: Actor = { role: "authenticated", claims: { role: "authenticated", sub: OTHER_SELLER } };
const anon: Actor = { role: "anon", claims: { role: "anon" } };

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_SCHEMA);
  await db.exec(MIGRATION);
  await db.exec(DASHBOARD_POLICY);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function seedVehicle(status: VehicleStatus, sellerId = SELLER): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.vehicles (seller_id, status) values ($1, $2) returning id",
    [sellerId, status],
  );
  return rows[0].id;
}

/** Storage API'nin yaptığı gibi: isteği yapanın rolü ve JWT'siyle storage.objects'e ekler */
async function upload(actor: Actor, name: string, bucket = PHOTO_BUCKET): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      await tx.exec(`set local role ${actor.role}`);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(actor.claims)]);
      await tx.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [bucket, name]);
    });
    return true;
  } catch {
    return false;
  }
}

describe("vehicle-photos bucket sınırları", () => {
  it("boyut ve MIME sınırı istemcideki kurallarla aynı", async () => {
    const { rows } = await db.query<{ file_size_limit: string | number; allowed_mime_types: string[] }>(
      "select file_size_limit, allowed_mime_types from storage.buckets where id = $1",
      [PHOTO_BUCKET],
    );
    expect(Number(rows[0].file_size_limit)).toBe(MAX_PHOTO_BYTES);
    expect(rows[0].allowed_mime_types).toEqual([...PHOTO_MIME_TYPES]);
  });

  it("diğer bucket'a dokunulmaz", async () => {
    const { rows } = await db.query<{ file_size_limit: number | null }>(
      "select file_size_limit from storage.buckets where id = 'vehicle-images'",
    );
    expect(rows[0].file_size_limit).toBeNull();
  });

  it("bucket yoksa migration durur", async () => {
    const fresh = new PGlite();
    try {
      await fresh.exec(BASE_SCHEMA);
      await fresh.exec("delete from storage.buckets where id = 'vehicle-photos'");
      await expect(fresh.exec(MIGRATION)).rejects.toThrow(/bulunamadı/);
    } finally {
      await fresh.close();
    }
  }, 60_000);
});

describe("vehicle-photos: yükleme yetkisi", () => {
  it.each(["draft", "pending_video"] as const)(
    "satıcı, %s ilanına uygulamanın ürettiği yollarla yükleyebilir",
    async (status) => {
      const id = await seedVehicle(status);
      for (const mimeType of PHOTO_MIME_TYPES) {
        expect(await upload(seller, photoStoragePath(id, 0, mimeType))).toBe(true);
        expect(await upload(seller, photoStoragePath(id, MAX_PHOTOS - 1, mimeType))).toBe(true);
      }
    },
  );

  it.each<[string, (id: string) => string]>([
    ["fotoğraf sınırının üstünde sıra", (id) => photoStoragePath(id, MAX_PHOTOS, "image/jpeg")],
    ["HEIC", (id) => photoStoragePath(id, 0, "image/heic")],
    ["SVG", (id) => photoStoragePath(id, 0, "image/svg+xml")],
    ["HTML", (id) => `${id}/0.html`],
    ["çift uzantı", (id) => `${id}/0.png.html`],
    ["büyük harfli uzantı", (id) => `${id}/0.PNG`],
    ["uzantısız", (id) => `${id}/0`],
    ["sayı olmayan dosya adı", (id) => `${id}/kapak.png`],
    ["alt klasör", (id) => `${id}/x/0.png`],
    ["üst klasöre çıkış", (id) => `${id}/../0.png`],
    ["başa eklenmiş klasör", (id) => `${SELLER}/${id}/0.png`],
    ["büyük harfli ilan id'si", (id) => `${id.toUpperCase()}/0.png`],
    ["ilan klasörü olmayan dosya", () => "0.png"],
    ["ilan id'si olmayan klasör", () => "abc/0.png"],
  ])("reddedilir: %s", async (_label, nameFor) => {
    const id = await seedVehicle("pending_video");
    expect(await upload(seller, nameFor(id))).toBe(false);
  });

  it.each(["active", "sold", "archived", "rejected"] as const)(
    "yayındaki ya da kapanmış (%s) ilana yüklenemez",
    async (status) => {
      const id = await seedVehicle(status);
      expect(await upload(seller, photoStoragePath(id, 0, "image/jpeg"))).toBe(false);
    },
  );

  it("başkasının ilanına ve olmayan bir ilana yüklenemez", async () => {
    const id = await seedVehicle("pending_video", OTHER_SELLER);
    expect(await upload(seller, photoStoragePath(id, 0, "image/jpeg"))).toBe(false);
    expect(await upload(otherSeller, photoStoragePath(id, 0, "image/jpeg"))).toBe(true);
    expect(await upload(seller, photoStoragePath("33333333-3333-4333-8333-333333333333", 0, "image/jpeg"))).toBe(
      false,
    );
  });

  it("anonim istek yükleyemez; fonksiyon anonim role kapalı", async () => {
    const id = await seedVehicle("pending_video");
    expect(await upload(anon, photoStoragePath(id, 0, "image/jpeg"))).toBe(false);

    const { rows } = await db.query<{ anon: boolean; authenticated: boolean }>(
      `select has_function_privilege('anon', 'public.fn_can_upload_vehicle_photo(text)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.fn_can_upload_vehicle_photo(text)', 'execute') as authenticated`,
    );
    expect(rows[0]).toEqual({ anon: false, authenticated: true });
  });

  it("geçerli yol başka bir bucket'a yüklenemez", async () => {
    const id = await seedVehicle("pending_video");
    expect(await upload(seller, photoStoragePath(id, 0, "image/jpeg"), "vehicle-images")).toBe(false);
  });
});
