// Kullanıcının yazdığı marka/model: 20260926200000_user_catalog_entries.sql
// gerçek bir Postgres'te (PGlite) çalıştırılır. BASE_SCHEMA, uzak
// veritabanındaki brands/models tanımlarının (2026-09-26) asgari kopyasıdır.

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import { MAX_BRAND_NAME, MAX_MODEL_NAME, catalogKey, catalogNameError } from "./catalog-search";

const MIGRATION = readFileSync("supabase/migrations/20260926200000_user_catalog_entries.sql", "utf8");

const SELLER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const BASE_SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;

  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.jwt() returns jsonb language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true), '')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  insert into auth.users values ('${SELLER}'), ('${OTHER}');

  create table public.brands (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    slug text not null unique,
    created_at timestamptz not null default now()
  );
  create table public.models (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands(id) on delete cascade,
    name text not null,
    slug text not null,
    created_at timestamptz not null default now(),
    unique (brand_id, slug)
  );
  alter table public.brands enable row level security;
  alter table public.models enable row level security;
  create policy brands_select_all on public.brands for select using (true);
  create policy models_select_all on public.models for select using (true);
  -- Supabase'deki gibi tablo yetkileri geniş; yazmayı RLS engelliyor
  grant all on public.brands, public.models to anon, authenticated;

  insert into public.brands (name, slug) values ('BMW', 'bmw'), ('Toyota', 'toyota'), ('Skoda', 'skoda');
  insert into public.models (brand_id, name, slug)
    select b.id, m.name, m.slug from public.brands b
    join (values ('BMW', '3 Serisi', '3-serisi'), ('BMW', 'X5', 'x5'), ('Toyota', 'C-HR', 'c-hr'), ('Skoda', 'Octavia', 'octavia'))
      as m(brand, name, slug) on m.brand = b.name;
`;

type Actor = { role: "anon" | "authenticated"; claims: Record<string, string> };
const seller: Actor = { role: "authenticated", claims: { role: "authenticated", sub: SELLER } };
const other: Actor = { role: "authenticated", claims: { role: "authenticated", sub: OTHER } };
const anon: Actor = { role: "anon", claims: { role: "anon" } };

let db: PGlite;
let ids: Record<string, string>;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_SCHEMA);
  await db.exec(MIGRATION);
  const { rows } = await db.query<{ key: string; id: string }>(
    `select name as key, id from public.brands union all select b.name || '/' || m.name, m.id from public.models m join public.brands b on b.id = m.brand_id`,
  );
  ids = Object.fromEntries(rows.map((r) => [r.key, r.id]));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("delete from public.models where is_user_created; delete from public.brands where is_user_created;");
});

type Resolved = { brand_id: string; model_id: string };

async function resolve(
  actor: Actor,
  args: { brandId?: string | null; brandName?: string | null; modelId?: string | null; modelName?: string | null },
): Promise<{ ok: true; value: Resolved } | { ok: false; message: string }> {
  try {
    const value = await db.transaction(async (tx) => {
      await tx.exec(`set local role ${actor.role}`);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(actor.claims)]);
      const { rows } = await tx.query<Resolved>("select * from public.resolve_listing_catalog($1, $2, $3, $4)", [
        args.brandId ?? null,
        args.brandName ?? null,
        args.modelId ?? null,
        args.modelName ?? null,
      ]);
      return rows[0];
    });
    return { ok: true, value };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

async function userCreated() {
  const { rows } = await db.query<{ kind: string; name: string; slug: string; created_by: string }>(
    `select 'brand' as kind, name, slug, created_by from public.brands where is_user_created
     union all select 'model', name, slug, created_by from public.models where is_user_created order by 1, 2`,
  );
  return rows;
}

describe("resolve_listing_catalog", () => {
  it("katalogdan seçilen marka ve model olduğu gibi döner; hiçbir şey eklenmez", async () => {
    expect(await resolve(seller, { brandId: ids.BMW, modelId: ids["BMW/3 Serisi"] })).toEqual({
      ok: true,
      value: { brand_id: ids.BMW, model_id: ids["BMW/3 Serisi"] },
    });
    expect(await userCreated()).toEqual([]);
  });

  it("başka markanın modeli reddedilir", async () => {
    expect(await resolve(seller, { brandId: ids.BMW, modelId: ids["Toyota/C-HR"] })).toMatchObject({
      ok: false,
      message: "Model bu markaya ait değil.",
    });
  });

  it("katalogdaki markaya yeni model eklenir; aynı ad farklı yazılsa da tek kayıt", async () => {
    const first = await resolve(seller, { brandId: ids.BMW, modelName: "  M340i   xDrive " });
    expect(first.ok).toBe(true);
    expect(await userCreated()).toEqual([{ kind: "model", name: "M340i xDrive", slug: "m340i-xdrive", created_by: SELLER }]);

    const again = await resolve(other, { brandId: ids.BMW, modelName: "m340İ-XDRİVE" });
    expect(again).toEqual(first);
    expect(await userCreated()).toHaveLength(1);
  });

  it("katalogda olan adı yazmak mevcut kaydı döner (Türkçe/aksan/noktalama önemsiz)", async () => {
    expect(await resolve(seller, { brandId: ids.BMW, modelName: "3 serisi" })).toEqual({
      ok: true,
      value: { brand_id: ids.BMW, model_id: ids["BMW/3 Serisi"] },
    });
    expect(await resolve(seller, { brandName: "Škoda", modelName: "OCTAVIA" })).toEqual({
      ok: true,
      value: { brand_id: ids.Skoda, model_id: ids["Skoda/Octavia"] },
    });
    expect(await resolve(seller, { brandName: "toyota", modelName: "c hr" })).toEqual({
      ok: true,
      value: { brand_id: ids.Toyota, model_id: ids["Toyota/C-HR"] },
    });
    expect(await userCreated()).toEqual([]);
  });

  it("yeni marka ve modeli birlikte ekler", async () => {
    const result = await resolve(seller, { brandName: "Togg", modelName: "T10X" });
    expect(result.ok).toBe(true);
    expect(await userCreated()).toEqual([
      { kind: "brand", name: "Togg", slug: "togg", created_by: SELLER },
      { kind: "model", name: "T10X", slug: "t10x", created_by: SELLER },
    ]);
    expect(await resolve(other, { brandName: "TOGG", modelName: "t10x" })).toEqual(result);
  });

  it.each([
    ["boş", { modelName: "   " }],
    ["uzun", { modelName: "a".repeat(61) }],
    ["izin verilmeyen karakter", { modelName: "<script>" }],
    ["ASCII harf/rakam yok", { modelName: "Şş" }],
  ])("geçersiz ad reddedilir: %s", async (_label, args) => {
    const result = await resolve(seller, { ...args, brandId: ids.BMW });
    expect(result.ok).toBe(false);
    expect(await userCreated()).toEqual([]);
  });

  it("günlük sınır: kullanıcı başına 10 yeni kayıt", async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await resolve(seller, { brandId: ids.BMW, modelName: `Deneme ${i}` })).ok).toBe(true);
    }
    expect(await resolve(seller, { brandId: ids.BMW, modelName: "Deneme 10" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("Bugün yeterince yeni marka/model ekledin"),
    });
    // Var olanı seçmek sınıra takılmaz; başka kullanıcı etkilenmez
    expect((await resolve(seller, { brandId: ids.BMW, modelName: "deneme 3" })).ok).toBe(true);
    expect((await resolve(other, { brandId: ids.BMW, modelName: "Başka" })).ok).toBe(true);
  });

  it("giriş yapmadan çağrılamaz; kataloğa doğrudan yazılamaz", async () => {
    expect((await resolve(anon, { brandName: "Togg", modelName: "T10X" })).ok).toBe(false);

    const direct = await db
      .transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(seller.claims)]);
        await tx.query("insert into public.models (brand_id, name, slug) values ($1, 'Hack', 'hack')", [ids.BMW]);
        return "yazıldı";
      })
      .catch(() => "reddedildi");
    expect(direct).toBe("reddedildi");
    expect(await userCreated()).toEqual([]);
  });

  it("aynı anahtarlı ikinci kaydı veritabanı da reddeder", async () => {
    await expect(db.query("insert into public.brands (name, slug) values ('b.m.w', 'b-m-w')")).rejects.toThrow();
  });
});

describe("TS ve SQL kuralları aynı", () => {
  const samples = [
    "Mercedes-Benz",
    "  mercedes   BENZ ",
    "C-HR",
    "Škoda",
    "Citroën",
    "İSTANBUL ışık Şahin Ğ",
    "3 Serisi",
    "M340i xDrive",
    "D'Artagnan",
    "Model 3/Y",
    "A&B Özel",
    "<script>",
    "-X",
    "Ş",
    "Model #1",
    "a".repeat(41),
    "a".repeat(61),
    "   ",
  ];

  it.each(samples)("anahtar: %j", async (name) => {
    const { rows } = await db.query<{ key: string }>("select public.fn_catalog_key($1) as key", [name]);
    expect(rows[0].key).toBe(catalogKey(name));
  });

  it.each(samples.flatMap((name) => [[name, MAX_BRAND_NAME] as const, [name, MAX_MODEL_NAME] as const]))(
    "ad geçerliliği: %j (en fazla %i)",
    async (name, max) => {
      const sqlValid = await db
        .query("select public.fn_clean_catalog_name($1, $2)", [name, max])
        .then(() => true)
        .catch(() => false);
      expect(sqlValid).toBe(catalogNameError(name, max) === null);
    },
  );
});
