// Veritabanı testleri: uygulama ayarları (20261018120000_app_settings.sql).
//
// Migration gerçek bir Postgres'te (PGlite) çalışır. Supabase'deki gibi public
// şemadaki yeni tablolar varsayılan olarak anon/authenticated/service_role'e
// açılır (default privileges); migration bunu geri almalı. Beklenen: tarayıcı
// rolleri (anon, authenticated) app_settings'i ne okuyabilir ne yazabilir; sunucu
// (service_role) /cansu-kamil kapatma bayrağını yazıp okuyabilir.

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CANSU_DISABLED_KEY } from "./cansu-kamil-switch";

const FILE = "20261018120000_app_settings.sql";
const MIGRATION = readFileSync(`supabase/migrations/${FILE}`, "utf8");
const USER = "11111111-1111-4111-8111-111111111111";

const BASE_SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_SCHEMA);
  await db.exec(MIGRATION);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

/** Sorguyu verilen rolle (ve isteğe bağlı JWT claim'leriyle) bir işlem içinde çalıştırır */
async function asRole(role: "anon" | "authenticated" | "service_role", sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    if (role === "authenticated") {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USER, role })]);
    }
    return tx.query<{ value: unknown }>(sql, params);
  });
}

describe("app_settings", () => {
  it("migration en son: boya/değişen şemasından sonra uygulanır", () => {
    const migrations = readdirSync("supabase/migrations").sort();
    expect(migrations.at(-1)).toBe(FILE);
    expect(migrations.indexOf(FILE)).toBeGreaterThan(migrations.indexOf("20260929120000_expertise_parts.sql"));
  });

  it("sunucu (service_role) bayrağı yazar, günceller ve okur", async () => {
    await asRole(
      "service_role",
      `insert into public.app_settings (key, value, updated_by) values ($1, 'true'::jsonb, $2)
       on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
      [CANSU_DISABLED_KEY, USER],
    );
    let { rows } = await asRole("service_role", "select value from public.app_settings where key = $1", [CANSU_DISABLED_KEY]);
    expect(rows).toEqual([{ value: true }]);

    await asRole("service_role", "update public.app_settings set value = 'false'::jsonb where key = $1", [CANSU_DISABLED_KEY]);
    ({ rows } = await asRole("service_role", "select value from public.app_settings where key = $1", [CANSU_DISABLED_KEY]));
    expect(rows).toEqual([{ value: false }]);
  });

  it("misafir ve giriş yapmış kullanıcı okuyamaz, yazamaz, silemez", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await expect(asRole(role, "select value from public.app_settings")).rejects.toThrow(/permission denied/);
      await expect(
        asRole(role, "insert into public.app_settings (key, value) values ($1, 'false'::jsonb)", [CANSU_DISABLED_KEY]),
      ).rejects.toThrow(/permission denied/);
      await expect(asRole(role, "update public.app_settings set value = 'false'::jsonb")).rejects.toThrow(/permission denied/);
      await expect(asRole(role, "delete from public.app_settings")).rejects.toThrow(/permission denied/);
    }
  });

  it("RLS açık; anahtar biçimi denetlenir", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where oid = 'public.app_settings'::regclass",
    );
    expect(rows).toEqual([{ relrowsecurity: true }]);
    await expect(
      asRole("service_role", "insert into public.app_settings (key, value) values ('Bad-Key', 'true'::jsonb)"),
    ).rejects.toThrow(/check constraint/);
  });

  it("migration tekrar çalıştırılabilir; var olan bayrak korunur", async () => {
    await db.exec(MIGRATION);
    const { rows } = await asRole("service_role", "select value from public.app_settings where key = $1", [CANSU_DISABLED_KEY]);
    expect(rows).toEqual([{ value: false }]);
  });
});
