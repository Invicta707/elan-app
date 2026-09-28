// Güvenlik testleri: test (deneme) ilanı işareti (20260928200000_test_listings.sql).
//
// Migration gerçek bir Postgres'te (PGlite) çalışır; istekler Supabase'deki gibi
// rol (set role) ve JWT claim'leriyle taklit edilir. İşareti yalnızca sunucu
// (servis anahtarı, veritabanı yöneticisi) yazabilmeli: satıcı kendi ilanını
// test olarak işaretleyip toplu silmeye sokamamalı, test ilanını da gerçek
// ilana çeviremeyip etiketi kaldıramamalı.

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = readFileSync("supabase/migrations/20260928200000_test_listings.sql", "utf8");

const SELLER = "11111111-1111-4111-8111-111111111111";

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
    created_at timestamptz not null default now()
  );
  grant all on public.vehicles to anon, authenticated, service_role;
  alter table public.vehicles enable row level security;
  create policy vehicles_select on public.vehicles for select using (status = 'active' or auth.uid() = seller_id);
  create policy vehicles_insert_own on public.vehicles for insert with check (auth.uid() = seller_id);
  create policy vehicles_update_own on public.vehicles for update using (auth.uid() = seller_id);
`;

type Actor = { role: "anon" | "authenticated" | "service_role" | null; claims: Record<string, string> | null };
const seller: Actor = { role: "authenticated", claims: { role: "authenticated", sub: SELLER } };
const anon: Actor = { role: "anon", claims: { role: "anon" } };
const serviceRole: Actor = { role: "service_role", claims: { role: "service_role" } };
/** Veritabanı yöneticisi (migration, SQL Editor): rol ve JWT yok */
const admin: Actor = { role: null, claims: null };

type Outcome<T = Record<string, unknown>> = { ok: true; rows: T[] } | { ok: false; code: string; message: string };

let db: PGlite;

async function run<T = Record<string, unknown>>(actor: Actor, sql: string, params: unknown[] = []): Promise<Outcome<T>> {
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

async function insertAsAdmin(isTest: boolean): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.vehicles (seller_id, status, is_test) values ($1, 'active', $2) returning id",
    [SELLER, isTest],
  );
  return rows[0].id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_SCHEMA);
  // Migration'dan önce açılmış ilan: sütun eklenince false olmalı
  await db.query("insert into public.vehicles (seller_id, status) values ($1, 'active')", [SELLER]);
  await db.exec(MIGRATION);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("test ilanı işareti", () => {
  it("migration yorum şikayetlerinden sonra uygulanır", () => {
    const migrations = readdirSync("supabase/migrations").sort();
    expect(migrations).toContain("20260928200000_test_listings.sql");
    expect(migrations.indexOf("20260928200000_test_listings.sql")).toBeGreaterThan(migrations.indexOf("20260928180000_comment_reports.sql"));
  });

  it("var olan ilanlar gerçek ilan (false) olarak kalır; migration tekrar çalıştırılabilir", async () => {
    const { rows } = await db.query<{ is_test: boolean }>("select is_test from public.vehicles");
    expect(rows.every((row) => row.is_test === false)).toBe(true);
    await expect(db.exec(MIGRATION)).resolves.toBeDefined();
  });

  it("satıcı yeni ilanı test olarak açamaz; varsayılanla (false) açabilir", async () => {
    const denied = await run(seller, "insert into public.vehicles (seller_id, is_test) values ($1, true)", [SELLER]);
    expect(denied).toMatchObject({ ok: false, code: "42501" });
    expect(denied.ok === false && denied.message).toContain("yalnızca yönetim");

    const allowed = await run<{ is_test: boolean }>(seller, "insert into public.vehicles (seller_id) values ($1) returning is_test", [SELLER]);
    expect(allowed).toMatchObject({ ok: true, rows: [{ is_test: false }] });
  });

  it("satıcı ilanını test olarak işaretleyemez, test ilanının işaretini kaldıramaz", async () => {
    const real = await insertAsAdmin(false);
    const test = await insertAsAdmin(true);
    expect(await run(seller, "update public.vehicles set is_test = true where id = $1", [real])).toMatchObject({ ok: false, code: "42501" });
    expect(await run(seller, "update public.vehicles set is_test = false where id = $1", [test])).toMatchObject({ ok: false, code: "42501" });
    const { rows } = await db.query<{ id: string; is_test: boolean }>("select id, is_test from public.vehicles where id in ($1, $2)", [real, test]);
    expect(Object.fromEntries(rows.map((row) => [row.id, row.is_test]))).toEqual({ [real]: false, [test]: true });
  });

  it("işaret değişmedikçe diğer güncellemeler serbest (aynı değeri yazmak da)", async () => {
    const test = await insertAsAdmin(true);
    expect(await run(seller, "update public.vehicles set city = 'Bursa' where id = $1", [test])).toMatchObject({ ok: true });
    expect(await run(seller, "update public.vehicles set is_test = true, city = 'İzmir' where id = $1", [test])).toMatchObject({ ok: true });
  });

  it("misafir de açamaz; servis anahtarı ve yönetici işareti yazar ve kaldırır", async () => {
    expect(await run(anon, "insert into public.vehicles (seller_id, is_test) values ($1, true)", [SELLER])).toMatchObject({ ok: false });

    const created = await run<{ id: string }>(serviceRole, "insert into public.vehicles (seller_id, is_test) values ($1, true) returning id", [SELLER]);
    expect(created).toMatchObject({ ok: true });
    const id = created.ok ? created.rows[0].id : "";
    expect(await run(serviceRole, "update public.vehicles set is_test = false where id = $1", [id])).toMatchObject({ ok: true });
    expect(await run(admin, "update public.vehicles set is_test = true where id = $1", [id])).toMatchObject({ ok: true });
  });

  it("herkes (misafir dahil) yayındaki ilanın işaretini okuyabilir: etiket kartta gösterilir", async () => {
    const test = await insertAsAdmin(true);
    const read = await run<{ is_test: boolean }>(anon, "select is_test from public.vehicles where id = $1", [test]);
    expect(read).toMatchObject({ ok: true, rows: [{ is_test: true }] });
  });
});
