// Veritabanı testleri: boya/değişen şeması verisi (20260929120000_expertise_parts.sql).
//
// Migration gerçek bir Postgres'te (PGlite) çalışır; satıcı istekleri
// Supabase'deki gibi rol ve JWT claim'leriyle taklit edilir. Beklenen:
// expertise_summary.parts yalnızca 13 parça ve 4 durumla yazılabilir; parça
// listesi varsa boyalı/değişen sayıları ondan türetilir (istemcinin yazdığı
// sayılar yok sayılır); listesi olmayan eski ilanların sayılarına dokunulmaz.
// Ayrıca /sell'in gönderdiği kaydın (buildListingRecords) birebir yazılması.

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BODY_PARTS, BODY_PART_STATUSES, bodyPartCounts, expertiseSummary, parseBodyParts, type BodyPartMap } from "./body-parts";
import { buildListingRecords, EMPTY_LISTING_DRAFT } from "./listing";

const MIGRATION = readFileSync("supabase/migrations/20260929120000_expertise_parts.sql", "utf8");
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
    brand_id uuid,
    model_id uuid,
    year integer,
    mileage_km integer,
    price numeric,
    currency text,
    city text,
    body_type text,
    fuel_type text,
    transmission text,
    has_heavy_damage boolean not null default false,
    description text,
    status text not null default 'draft',
    expertise_summary jsonb not null default '{}'::jsonb,
    painted_parts_count integer not null default 0 check (painted_parts_count >= 0),
    changed_parts_count integer not null default 0 check (changed_parts_count >= 0)
  );
  grant all on public.vehicles to anon, authenticated, service_role;
  alter table public.vehicles enable row level security;
  create policy vehicles_select on public.vehicles for select using (status = 'active' or auth.uid() = seller_id);
  create policy vehicles_insert_own on public.vehicles for insert with check (auth.uid() = seller_id);
  create policy vehicles_update_own on public.vehicles for update using (auth.uid() = seller_id);
`;

type Outcome<T = Record<string, unknown>> = { ok: true; rows: T[] } | { ok: false; code: string; message: string };

let db: PGlite;

async function asSeller<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<Outcome<T>> {
  try {
    return await db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "authenticated", sub: SELLER })]);
      const result = await tx.query<T>(sql, params);
      return { ok: true as const, rows: result.rows };
    });
  } catch (error) {
    const { code = "", message = "" } = error as { code?: string; message?: string };
    return { ok: false, code, message };
  }
}

type Counts = { painted_parts_count: number; changed_parts_count: number };

const insertSummary = (summary: unknown, painted = 0, changed = 0) =>
  asSeller<Counts & { id: string }>(
    "insert into public.vehicles (seller_id, expertise_summary, painted_parts_count, changed_parts_count) values ($1, $2::jsonb, $3, $4) returning id, painted_parts_count, changed_parts_count",
    [SELLER, JSON.stringify(summary), painted, changed],
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_SCHEMA);
  // Migration'dan önceki ilanlar: parça listesi yok, sayılar elle
  await db.query("insert into public.vehicles (seller_id, painted_parts_count, changed_parts_count) values ($1, 2, 1)", [SELLER]);
  await db.exec(MIGRATION);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("expertise_summary.parts", () => {
  it("migration izlenme sayacından sonra uygulanır", () => {
    const migrations = readdirSync("supabase/migrations").sort();
    expect(migrations.indexOf("20260929120000_expertise_parts.sql")).toBeGreaterThan(migrations.indexOf("20260929100000_vehicle_views.sql"));
  });

  it("eski ilanlar (parça listesi yok) olduğu gibi kalır; migration tekrar çalıştırılabilir", async () => {
    const { rows } = await db.query<Counts & { expertise_summary: unknown }>(
      "select painted_parts_count, changed_parts_count, expertise_summary from public.vehicles order by painted_parts_count desc limit 1",
    );
    expect(rows[0]).toEqual({ painted_parts_count: 2, changed_parts_count: 1, expertise_summary: {} });
    await expect(db.exec(MIGRATION)).resolves.toBeDefined();
  });

  it("geçerli liste yazılır; sayılar listeden türetilir (lokal boya da boyalı sayılır), gönderilen sayı yok sayılır", async () => {
    const outcome = await insertSummary({ parts: { hood: "painted", front_bumper: "local_paint", trunk: "changed", roof: "original" } }, 9, 9);
    expect(outcome).toMatchObject({ ok: true, rows: [{ painted_parts_count: 2, changed_parts_count: 1 }] });
  });

  it("13 parçanın hepsi ve her durum geçerli", async () => {
    const statuses = ["original", "local_paint", "painted", "changed"];
    const parts = Object.fromEntries(BODY_PARTS.map((part, index) => [part.key, statuses[index % 4]]));
    const outcome = await insertSummary({ parts });
    // 13 parça: sırayla original, local_paint, painted, changed …
    expect(outcome).toMatchObject({ ok: true, rows: [{ painted_parts_count: 6, changed_parts_count: 3 }] });
  });

  it("boş liste (hepsi orijinal) sayıları sıfırlar", async () => {
    expect(await insertSummary({ parts: {} }, 3, 2)).toMatchObject({ ok: true, rows: [{ painted_parts_count: 0, changed_parts_count: 0 }] });
  });

  it("bilinmeyen parça, bilinmeyen durum, sayı ya da dizi reddedilir (23514)", async () => {
    for (const summary of [
      { parts: { wing: "painted" } },
      { parts: { hood: "yellow" } },
      { parts: { hood: 1 } },
      { parts: { hood: null } },
      { parts: ["hood"] },
      { parts: "hood" },
      [],
      "x",
    ]) {
      expect(await insertSummary(summary)).toMatchObject({ ok: false, code: "23514" });
    }
  });

  it("diğer üst düzey anahtarlar serbest; parça listesi yoksa sayılar elle kalır", async () => {
    expect(await insertSummary({ report: "ok" }, 2, 1)).toMatchObject({ ok: true, rows: [{ painted_parts_count: 2, changed_parts_count: 1 }] });
  });

  it("güncellemede de: satıcı sayıyı elle değiştiremez (liste varken); liste değişince sayılar yeniden hesaplanır", async () => {
    const created = await insertSummary({ parts: { hood: "painted" } });
    const id = created.ok ? created.rows[0].id : "";
    await asSeller("update public.vehicles set painted_parts_count = 0, changed_parts_count = 5 where id = $1", [id]);
    let { rows } = await db.query<Counts>("select painted_parts_count, changed_parts_count from public.vehicles where id = $1", [id]);
    expect(rows[0]).toEqual({ painted_parts_count: 1, changed_parts_count: 0 });

    await asSeller("update public.vehicles set expertise_summary = $2::jsonb where id = $1", [
      id,
      JSON.stringify({ parts: { hood: "changed", roof: "changed", left_front_door: "local_paint" } }),
    ]);
    ({ rows } = await db.query<Counts>("select painted_parts_count, changed_parts_count from public.vehicles where id = $1", [id]));
    expect(rows[0]).toEqual({ painted_parts_count: 1, changed_parts_count: 2 });

    expect(await asSeller("update public.vehicles set expertise_summary = '{\"parts\":{\"hood\":\"bent\"}}' where id = $1", [id])).toMatchObject({
      ok: false,
      code: "23514",
    });
  });

  it("TS ↔ SQL: tetikleyicinin sayıları bodyPartCounts ile, saklanan liste parseBodyParts ile aynı", async () => {
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    for (let i = 0; i < 40; i += 1) {
      const selection: BodyPartMap = {};
      for (const { key } of BODY_PARTS) if (next() % 2) selection[key] = BODY_PART_STATUSES[next() % 4];
      const summary = expertiseSummary(selection);
      const outcome = await asSeller<Counts & { expertise_summary: unknown }>(
        "insert into public.vehicles (seller_id, expertise_summary) values ($1, $2::jsonb) returning painted_parts_count, changed_parts_count, expertise_summary",
        [SELLER, JSON.stringify(summary)],
      );
      if (!outcome.ok) throw new Error(outcome.message);
      const row = outcome.rows[0];
      const counts = bodyPartCounts(selection);
      expect({ painted: row.painted_parts_count, changed: row.changed_parts_count }).toEqual({
        painted: counts.paintedPartsCount,
        changed: counts.changedPartsCount,
      });
      expect(parseBodyParts(row.expertise_summary) ?? {}).toEqual(summary.parts);
    }
  });

  it("/sell'in gönderdiği kayıt (buildListingRecords) birebir yazılır ve okunur", async () => {
    const records = buildListingRecords(SELLER, {
      ...EMPTY_LISTING_DRAFT,
      brandId: "b",
      modelId: "m",
      year: "2019",
      mileageKm: "85000",
      price: "750000",
      city: "İstanbul",
      bodyType: "sedan",
      fuelType: "dizel",
      transmission: "otomatik",
      whatsapp: "5445673430",
      bodyParts: { hood: "painted", front_bumper: "local_paint", trunk: "changed" },
    });
    const { vehicle } = records;
    const columns = Object.keys(vehicle).join(", ");
    // PostgREST'in yaptığı gibi: JSON gövde tablonun sütunlarına eşlenir
    const outcome = await asSeller<Counts & { expertise_summary: unknown }>(
      `insert into public.vehicles (${columns})
       select ${columns} from jsonb_populate_record(null::public.vehicles, $1::jsonb)
       returning painted_parts_count, changed_parts_count, expertise_summary`,
      [JSON.stringify(vehicle)],
    );
    expect(outcome).toMatchObject({
      ok: true,
      rows: [
        {
          painted_parts_count: 2,
          changed_parts_count: 1,
          expertise_summary: { parts: { front_bumper: "local_paint", hood: "painted", trunk: "changed" } },
        },
      ],
    });
  });
});
