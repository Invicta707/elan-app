// Güvenlik testleri: kullanıcı adı, takip sistemi, takip edilenler akışı,
// görünen ad, engellenenler listesi ve profilden doğrudan mesaj.
//
// 20260926210000_profiles_and_messaging.sql, 20260927120000_usernames_and_follows.sql,
// 20260927150000_profile_name_and_blocked_list.sql, 20260927180000_direct_conversations.sql
// ve 20260927200000_direct_dm_requires_username.sql gerçek bir Postgres'te (PGlite) çalıştırılır; istekler Supabase'deki gibi rol
// (set role) ve JWT claim'leriyle taklit edilir. BASE_SCHEMA, uzak veritabanındaki
// ilgili tanımların (2026-09-27) asgari kopyasıdır.

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DIRECT_USERNAME_REQUIRED } from "./messages";
import { RESERVED_USERNAMES, localUsernameStatus } from "./username";

const MESSAGING = readFileSync("supabase/migrations/20260926210000_profiles_and_messaging.sql", "utf8");
const SOCIAL = readFileSync("supabase/migrations/20260927120000_usernames_and_follows.sql", "utf8");
const PROFILE_NAME = readFileSync("supabase/migrations/20260927150000_profile_name_and_blocked_list.sql", "utf8");
const DIRECT = readFileSync("supabase/migrations/20260927180000_direct_conversations.sql", "utf8");
const DIRECT_USERNAME = readFileSync("supabase/migrations/20260927200000_direct_dm_requires_username.sql", "utf8");

const SELLER = "11111111-1111-4111-8111-111111111111";
const BUYER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const NEWBIE = "44444444-4444-4444-8444-444444444444";
const ACTIVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ARCHIVED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_ACTIVE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const BASE_SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.jwt() returns jsonb language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true), '')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  insert into auth.users values ('${SELLER}'), ('${BUYER}'), ('${OTHER}'), ('${NEWBIE}');

  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );

  create publication supabase_realtime;

  -- Supabase'in varsayılan yetkileri: public'teki yeni tablolar herkese açılır
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

  create type public.vehicle_status as enum ('draft', 'pending_video', 'active', 'sold', 'archived', 'rejected');
  create table public.brands (id uuid primary key default gen_random_uuid(), name text not null);
  create table public.models (id uuid primary key default gen_random_uuid(), brand_id uuid not null, name text not null);
  create table public.vehicles (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null,
    brand_id uuid, model_id uuid,
    year integer not null default 2020,
    price numeric not null default 1,
    currency text not null default 'TRY',
    status public.vehicle_status not null default 'draft',
    created_at timestamptz not null default now()
  );
  alter table public.vehicles enable row level security;
  create policy vehicles_select_active_or_own on public.vehicles for select
    using ((status = 'active') or (auth.uid() = seller_id));
  create table public.vehicle_images (
    id uuid primary key default gen_random_uuid(), vehicle_id uuid not null, image_url text,
    is_primary boolean not null default false, display_order integer not null default 0
  );
  create table public.videos (
    id uuid primary key default gen_random_uuid(), vehicle_id uuid not null, status text, thumbnail_url text
  );

  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    whatsapp_number text,
    created_at timestamptz default now()
  );
  alter table public.profiles enable row level security;
  create policy "Public profiles are viewable by everyone" on public.profiles for select using (true);
  create policy "Users can insert/update their own profile" on public.profiles for all using (auth.uid() = id);

  insert into public.vehicles (id, seller_id, status) values
    ('${ACTIVE}', '${SELLER}', 'active'),
    ('${ARCHIVED}', '${SELLER}', 'archived'),
    ('${OTHER_ACTIVE}', '${OTHER}', 'active');
  insert into public.profiles (id, whatsapp_number) values
    ('${SELLER}', '905551112233'), ('${BUYER}', null), ('${OTHER}', null);
`;

type Actor = { role: "anon" | "authenticated" | "service_role"; sub?: string };
const as = (sub: string): Actor => ({ role: "authenticated", sub });
const anon: Actor = { role: "anon" };
const service: Actor = { role: "service_role" };

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_SCHEMA);
  await db.exec(MESSAGING);
  await db.exec(SOCIAL);
  await db.exec(PROFILE_NAME);
  await db.exec(DIRECT);
  await db.exec(DIRECT_USERNAME);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  // Takipler tetikleyiciyle silinir: sayaçlar da sıfıra döner
  await db.exec(`
    delete from public.messages;
    delete from public.conversations;
    delete from public.follows;
    delete from public.user_blocks;
    delete from public.profiles where id = '${NEWBIE}';
    update public.profiles set username = null, username_changed_at = null, display_name = null,
      whatsapp_number = case when id = '${SELLER}' then '905551112233' end;
  `);
});

type Outcome<T> = { ok: true; rows: T[] } | { ok: false; code: string; message: string };

async function run<T = Record<string, unknown>>(actor: Actor, sql: string, params: unknown[] = []): Promise<Outcome<T>> {
  try {
    return await db.transaction(async (tx) => {
      await tx.exec(`set local role ${actor.role}`);
      const claims = actor.sub ? { role: actor.role, sub: actor.sub } : { role: actor.role };
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      const result = await tx.query<T>(sql, params);
      return { ok: true as const, rows: result.rows };
    });
  } catch (error) {
    const { code = "", message = "" } = error as { code?: string; message?: string };
    return { ok: false, code, message };
  }
}

async function value<T>(actor: Actor, sql: string, params: unknown[] = []): Promise<T> {
  const outcome = await run<{ v: T }>(actor, sql, params);
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.rows[0].v;
}

const setUsername = (sub: string, name: string) => run<{ v: string }>(as(sub), "select public.set_username($1) as v", [name]);
const checkUsername = (sub: string, name: string) => value<string>(as(sub), "select public.check_username($1) as v", [name]);
const follow = (sub: string, target: string, follower = sub) =>
  run(as(sub), "insert into public.follows (follower_id, following_id) values ($1, $2)", [follower, target]);

async function counts(id: string) {
  const { rows } = await db.query<{ followers_count: number; following_count: number }>(
    "select followers_count, following_count from public.profiles where id = $1",
    [id],
  );
  return rows[0];
}

async function usernameOf(id: string) {
  const { rows } = await db.query<{ username: string | null }>("select username from public.profiles where id = $1", [id]);
  return rows[0]?.username ?? null;
}

describe("kullanıcı adı: biçim ve küçük harf", () => {
  it.each(["kamil", "k_1", "araba_2026", "a".repeat(20), "123"])("geçerli: %s", async (name) => {
    expect(await setUsername(BUYER, name)).toEqual({ ok: true, rows: [{ v: name }] });
    expect(await usernameOf(BUYER)).toBe(name);
  });

  it.each(["ab", "a".repeat(21), "kamil.c", "kamil c", "kâmil", "kamil-c", "", "@kamil"])(
    "geçersiz: %j (Türkçe hata, 23514)",
    async (name) => {
      const result = await setUsername(BUYER, name);
      expect(result).toMatchObject({ ok: false, code: "23514" });
      expect(result.ok || result.message).toContain("3–20 karakter");
      expect(await usernameOf(BUYER)).toBeNull();
    },
  );

  it("büyük harfle yazılan ad küçük harfe çevrilip kaydedilir", async () => {
    expect(await setUsername(BUYER, "  Kamil_C ")).toEqual({ ok: true, rows: [{ v: "kamil_c" }] });
  });

  it("CHECK kısıtı RPC dışındaki yazımlarda da geçerli (servis anahtarı dahil)", async () => {
    for (const bad of ["Kamil", "ab", "admin", "gozuyle", "kamil!"]) {
      expect(
        await run(service, "update public.profiles set username = $1 where id = $2", [bad, BUYER]),
      ).toMatchObject({ ok: false, code: "23514" });
    }
    expect(await run(service, "update public.profiles set username = 'servis_ok' where id = $1", [BUYER])).toMatchObject({ ok: true });
  });
});

describe("kullanıcı adı: rezerve sözcükler", () => {
  it.each(["admin", "api", "sell", "search", "messages", "login", "auth", "terms", "privacy", "vitrin", "explore", "feed"])(
    "istenen rezerve sözcük alınamaz: %s",
    async (name) => {
      const result = await setUsername(BUYER, name);
      expect(result).toMatchObject({ ok: false, code: "23514", message: "Bu kullanıcı adı kullanılamaz." });
      expect(await checkUsername(BUYER, name)).toBe("reserved");
    },
  );

  it.each(["gozuyle", "gozuyle_destek", "resmi_gozuyle", "admin_kamil", "administrator", "moderator1", "destek_hatti", "support_tr"])(
    "marka adı ve yetkili görünen önekler alınamaz: %s",
    async (name) => {
      expect(await setUsername(BUYER, name)).toMatchObject({ ok: false, code: "23514" });
    },
  );

  it.each(["kamil_admin", "model_x", "api_oto", "feedback"])("benzer ama serbest adlar alınabilir: %s", async (name) => {
    expect(await setUsername(BUYER, name)).toMatchObject({ ok: true });
  });

  it("rezerve listesi ve kural TS tarafıyla (lib/username.ts) birebir aynı", async () => {
    const sqlList = (await db.query<{ v: string[] }>("select public.fn_reserved_usernames() as v")).rows[0].v;
    expect([...sqlList].sort()).toEqual([...RESERVED_USERNAMES].sort());
    expect(new Set(sqlList).size).toBe(sqlList.length);

    const samples = [
      ...RESERVED_USERNAMES,
      "kamil", "Kamil", "ab", "a".repeat(20), "a".repeat(21), "gozuyle", "xgozuylex", "admin", "admin_x",
      "x_admin", "moderatorx", "destek", "supporter", "support", "kamil.c", "_", "___", "a_b", "şahin", "123",
    ];
    for (const name of samples) {
      const { rows } = await db.query<{ v: boolean }>("select public.fn_is_valid_username($1) as v", [name]);
      expect([name, rows[0].v]).toEqual([name, localUsernameStatus(name) === null]);
    }
  });
});

describe("kullanıcı adı: benzersizlik, değişiklik ve yetkiler", () => {
  it("aynı ad ikinci kullanıcıya verilmez (büyük/küçük harf fark etmez)", async () => {
    expect(await setUsername(SELLER, "kamil")).toMatchObject({ ok: true });
    expect(await setUsername(BUYER, "KAMIL")).toMatchObject({ ok: false, code: "23505", message: "Bu kullanıcı adı alınmış." });
    expect(await usernameOf(BUYER)).toBeNull();
  });

  it("check_username: invalid, reserved, available, taken, current", async () => {
    await setUsername(SELLER, "kamil");
    expect(await checkUsername(BUYER, "ka")).toBe("invalid");
    expect(await checkUsername(BUYER, "sell")).toBe("reserved");
    expect(await checkUsername(BUYER, "yeni_ad")).toBe("available");
    expect(await checkUsername(BUYER, "Kamil")).toBe("taken");
    expect(await checkUsername(SELLER, "kamil")).toBe("current");
  });

  it("misafir kullanıcı adı RPC'lerini çağıramaz", async () => {
    expect(await run(anon, "select public.check_username('kamil')")).toMatchObject({ ok: false, code: "42501" });
    expect(await run(anon, "select public.set_username('kamil')")).toMatchObject({ ok: false, code: "42501" });
  });

  it("profil satırı olmayan kullanıcı adını belirleyebilir (satır açılır)", async () => {
    expect(await setUsername(NEWBIE, "yeni_uye")).toMatchObject({ ok: true });
    expect(await usernameOf(NEWBIE)).toBe("yeni_uye");
  });

  it("ilk belirleme ve ilk değişiklik serbest; sonra 7 gün beklenir, eski ad boşa çıkar", async () => {
    expect(await setUsername(BUYER, "ilk_ad")).toMatchObject({ ok: true });
    expect(await setUsername(BUYER, "ikinci_ad")).toMatchObject({ ok: true });
    expect(await setUsername(BUYER, "ikinci_ad")).toEqual({ ok: true, rows: [{ v: "ikinci_ad" }] });
    expect(await setUsername(BUYER, "ucuncu_ad")).toMatchObject({
      ok: false,
      code: "23514",
      message: "Kullanıcı adını 7 günde bir değiştirebilirsin.",
    });
    // Eski ad hemen başkası tarafından alınabilir
    expect(await setUsername(OTHER, "ilk_ad")).toMatchObject({ ok: true });

    await db.query("update public.profiles set username_changed_at = now() - interval '8 days' where id = $1", [BUYER]);
    expect(await setUsername(BUYER, "ucuncu_ad")).toMatchObject({ ok: true });
  });

  it("kullanıcı adı ve sayaçlar istemciden doğrudan yazılamaz", async () => {
    expect(await run(as(BUYER), "update public.profiles set username = 'hack' where id = $1", [BUYER])).toMatchObject({
      ok: false,
      code: "42501",
    });
    expect(
      await run(as(BUYER), "update public.profiles set followers_count = 999999 where id = $1", [BUYER]),
    ).toMatchObject({ ok: false, code: "42501" });
    expect(
      await run(as(NEWBIE), "insert into public.profiles (id, following_count) values ($1, 5)", [NEWBIE]),
    ).toMatchObject({ ok: false, code: "42501" });
    expect(
      await run(as(NEWBIE), "insert into public.profiles (id, username) values ($1, 'hack')", [NEWBIE]),
    ).toMatchObject({ ok: false, code: "42501" });
  });

  it("canlıdaki ilan verme upsert'ü kullanıcı adı olan profilde de çalışır", async () => {
    await setUsername(SELLER, "kamil");
    const upsert = `insert into public.profiles (id, whatsapp_number) values ($1, $2)
                    on conflict (id) do update set id = excluded.id, whatsapp_number = excluded.whatsapp_number`;
    expect(await run(as(SELLER), upsert, [SELLER, "905550000000"])).toMatchObject({ ok: true });
    const setName = "insert into public.profiles (id, display_name) values ($1, $2) on conflict (id) do update set display_name = excluded.display_name";
    expect(await run(as(SELLER), setName, [SELLER, "Kamil C."])).toMatchObject({ ok: true });
    expect(await usernameOf(SELLER)).toBe("kamil");
  });

  it("profiles satırını hâlâ yalnızca sahibi okur (WhatsApp numarası sızmaz)", async () => {
    await setUsername(SELLER, "kamil");
    expect(await run(as(BUYER), "select whatsapp_number from public.profiles where id = $1", [SELLER])).toEqual({
      ok: true,
      rows: [],
    });
    expect(await run(anon, "select username from public.profiles")).toMatchObject({ ok: false, code: "42501" });
  });
});

describe("follows: yetkiler ve kurallar", () => {
  it("herkes okuyabilir (misafir dahil)", async () => {
    await follow(BUYER, SELLER);
    expect(await run(anon, "select follower_id, following_id from public.follows")).toEqual({
      ok: true,
      rows: [{ follower_id: BUYER, following_id: SELLER }],
    });
  });

  it("yalnızca kendi adına takip eder; misafir takip edemez", async () => {
    expect(await follow(BUYER, SELLER)).toMatchObject({ ok: true });
    expect(await follow(BUYER, SELLER, OTHER)).toMatchObject({ ok: false, code: "42501" });
    expect(
      await run(anon, "insert into public.follows (follower_id, following_id) values ($1, $2)", [OTHER, SELLER]),
    ).toMatchObject({ ok: false, code: "42501" });
    const { rows } = await db.query("select follower_id from public.follows");
    expect(rows).toEqual([{ follower_id: BUYER }]);
  });

  it("kendini takip edemez", async () => {
    expect(await follow(BUYER, BUYER)).toMatchObject({ ok: false, code: "23514" });
    expect(await run(service, "insert into public.follows (follower_id, following_id) values ($1, $1)", [SELLER])).toMatchObject({
      ok: false,
      code: "23514",
    });
  });

  it("aynı kişiyi iki kez takip edemez", async () => {
    expect(await follow(BUYER, SELLER)).toMatchObject({ ok: true });
    expect(await follow(BUYER, SELLER)).toMatchObject({ ok: false, code: "23505" });
    expect((await counts(SELLER)).followers_count).toBe(1);
  });

  it("id ve created_at istemciden yazılamaz", async () => {
    expect(
      await run(
        as(BUYER),
        "insert into public.follows (follower_id, following_id, created_at) values ($1, $2, now() - interval '1 day')",
        [BUYER, SELLER],
      ),
    ).toMatchObject({ ok: false, code: "42501" });
  });

  it("takibi yalnızca takip eden bırakır", async () => {
    await follow(BUYER, SELLER);
    const unfollow = "delete from public.follows where follower_id = $1 and following_id = $2 returning id";
    expect(await run(as(SELLER), unfollow, [BUYER, SELLER])).toEqual({ ok: true, rows: [] });
    expect(await run(anon, unfollow, [BUYER, SELLER])).toMatchObject({ ok: false, code: "42501" });
    const own = await run(as(BUYER), unfollow, [BUYER, SELLER]);
    expect(own.ok && own.rows.length).toBe(1);
  });

  it("takip kaydı güncellenemez", async () => {
    await follow(BUYER, SELLER);
    expect(await run(as(BUYER), "update public.follows set following_id = $1", [OTHER])).toMatchObject({
      ok: false,
      code: "42501",
    });
  });

  it("profil satırı olmayan kullanıcı takip edebilir; olmayan kullanıcı takip edilemez", async () => {
    expect(await follow(NEWBIE, SELLER)).toMatchObject({ ok: true });
    expect(await counts(NEWBIE)).toEqual({ followers_count: 0, following_count: 1 });
    expect(await follow(BUYER, "99999999-9999-4999-8999-999999999999")).toMatchObject({ ok: false, code: "23503" });
  });

  it("engelleme: iki yöndeki takip kalkar, sayaçlar düşer, yeniden takip edilemez", async () => {
    await follow(BUYER, SELLER);
    await follow(SELLER, BUYER);
    expect(await counts(SELLER)).toEqual({ followers_count: 1, following_count: 1 });

    expect(
      await run(as(SELLER), "insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [SELLER, BUYER]),
    ).toMatchObject({ ok: true });
    expect((await db.query("select * from public.follows")).rows).toEqual([]);
    expect(await counts(SELLER)).toEqual({ followers_count: 0, following_count: 0 });
    expect(await counts(BUYER)).toEqual({ followers_count: 0, following_count: 0 });

    expect(await follow(BUYER, SELLER)).toMatchObject({ ok: false, code: "42501" });
    expect(await follow(SELLER, BUYER)).toMatchObject({ ok: false, code: "42501" });
  });

  it("hız sınırı: saatte en fazla 100 takip", async () => {
    await db.exec(`
      create temp table bulk as select gen_random_uuid() as id from generate_series(1, 101);
      insert into auth.users select id from bulk;
      insert into public.profiles (id) select id from bulk;
      insert into public.follows (follower_id, following_id)
        select '${BUYER}', id from bulk order by id limit 100;
    `);
    const last = (await db.query<{ id: string }>("select id from bulk order by id desc limit 1")).rows[0].id;
    expect(await follow(BUYER, last)).toMatchObject({
      ok: false,
      code: "23514",
      message: "Çok hızlı takip ediyorsun; biraz bekleyip tekrar dene.",
    });
    // Bir saatten eski takipler sayılmaz
    await db.exec(`update public.follows set created_at = now() - interval '2 hours' where follower_id = '${BUYER}'`);
    expect(await follow(BUYER, last)).toMatchObject({ ok: true });
    expect((await counts(BUYER)).following_count).toBe(101);
    await db.exec("delete from auth.users where id in (select id from bulk); drop table bulk;");
    expect((await counts(BUYER)).following_count).toBe(0);
  });
});

describe("follows: sayaçlar", () => {
  it("takip ve takibi bırakma iki tarafın sayacını günceller", async () => {
    await follow(BUYER, SELLER);
    await follow(OTHER, SELLER);
    await follow(BUYER, OTHER);
    expect(await counts(SELLER)).toEqual({ followers_count: 2, following_count: 0 });
    expect(await counts(BUYER)).toEqual({ followers_count: 0, following_count: 2 });
    expect(await counts(OTHER)).toEqual({ followers_count: 1, following_count: 1 });

    await run(as(BUYER), "delete from public.follows where follower_id = $1 and following_id = $2", [BUYER, SELLER]);
    expect(await counts(SELLER)).toEqual({ followers_count: 1, following_count: 0 });
    expect(await counts(BUYER)).toEqual({ followers_count: 0, following_count: 1 });
  });

  it("hesap silinince takipleri de silinir ve karşı tarafın sayacı düşer", async () => {
    const ghost = "55555555-5555-4555-8555-555555555555";
    await db.query("insert into auth.users values ($1)", [ghost]);
    await follow(ghost, SELLER);
    await follow(SELLER, ghost);
    expect(await counts(SELLER)).toEqual({ followers_count: 1, following_count: 1 });

    await db.query("delete from auth.users where id = $1", [ghost]);
    expect(await counts(SELLER)).toEqual({ followers_count: 0, following_count: 0 });
    expect((await db.query("select * from public.follows")).rows).toEqual([]);
  });
});

describe("get_public_profile", () => {
  it("misafire yalnızca herkese açık alanlar döner (numara yok), ilan sayısı yalnızca yayındakiler", async () => {
    await setUsername(SELLER, "kamil");
    await follow(BUYER, SELLER);
    const profile = await value<Record<string, unknown>>(anon, "select public.get_public_profile('kamil') as v");
    expect(profile).toEqual({
      id: SELLER,
      username: "kamil",
      display_name: null,
      avatar_url: null,
      followers_count: 1,
      following_count: 0,
      listings_count: 1,
      is_me: false,
      is_following: false,
    });
    expect(JSON.stringify(profile)).not.toContain("905551112233");
  });

  it("oturumdaki kullanıcı için takip durumu ve kendisi olup olmadığı", async () => {
    await setUsername(SELLER, "kamil");
    await follow(BUYER, SELLER);
    expect(await value(as(BUYER), "select public.get_public_profile('kamil') as v")).toMatchObject({
      is_following: true,
      is_me: false,
    });
    expect(await value(as(OTHER), "select public.get_public_profile('kamil') as v")).toMatchObject({ is_following: false });
    expect(await value(as(SELLER), "select public.get_public_profile('kamil') as v")).toMatchObject({ is_me: true });
  });

  it("büyük harfli adres de bulunur; olmayan ad null döner", async () => {
    await setUsername(SELLER, "kamil");
    expect(await value(anon, "select public.get_public_profile(' KAMIL ') as v")).toMatchObject({ id: SELLER });
    expect(await value(anon, "select public.get_public_profile('yok_boyle') as v")).toBeNull();
  });
});

describe("get_public_profiles", () => {
  it("yalnızca herkese açık yüzü olanlar: kullanıcı adı olan ya da yayında ilanı olan", async () => {
    await setUsername(BUYER, "alici");
    await follow(BUYER, SELLER);
    const rows = await value<Record<string, unknown>[]>(as(BUYER), "select public.get_public_profiles($1) as v", [
      [SELLER, BUYER, NEWBIE],
    ]);
    expect(rows.map((r) => r.id).sort()).toEqual([SELLER, BUYER].sort());
    expect(rows.find((r) => r.id === SELLER)).toEqual({
      id: SELLER,
      username: null,
      display_name: null,
      avatar_url: null,
      is_following: true,
    });
    expect(JSON.stringify(rows)).not.toContain("905551112233");

    // Ne kullanıcı adı ne yayında ilanı olan (OTHER'in ilanı arşive alınırsa)
    await db.query("update public.vehicles set status = 'archived' where id = $1", [OTHER_ACTIVE]);
    expect(await value(anon, "select public.get_public_profiles($1) as v", [[OTHER]])).toEqual([]);
    await db.query("update public.vehicles set status = 'active' where id = $1", [OTHER_ACTIVE]);
  });

  it("en fazla 50 kimlik işlenir", async () => {
    const ids = [...Array.from({ length: 50 }, () => NEWBIE), SELLER];
    expect(await value(anon, "select public.get_public_profiles($1) as v", [ids])).toEqual([]);
  });
});

describe("following_feed", () => {
  it("yalnızca takip edilenlerin yayındaki ilanları döner", async () => {
    await follow(BUYER, SELLER);
    const feed = await run<{ id: string }>(as(BUYER), "select id from public.following_feed() order by id");
    expect(feed).toEqual({ ok: true, rows: [{ id: ACTIVE }] });

    await follow(BUYER, OTHER);
    const both = await run<{ id: string }>(as(BUYER), "select id from public.following_feed() order by id");
    expect(both).toEqual({ ok: true, rows: [{ id: ACTIVE }, { id: OTHER_ACTIVE }] });
  });

  it("kimseyi takip etmeyen için boş; misafir çağıramaz", async () => {
    expect(await run(as(OTHER), "select id from public.following_feed()")).toEqual({ ok: true, rows: [] });
    expect(await run(anon, "select id from public.following_feed()")).toMatchObject({ ok: false, code: "42501" });
  });
});

describe("görünen ad (update_profile_display_name)", () => {
  const setName = (sub: string, name: string) =>
    run<{ v: string }>(as(sub), "select public.update_profile_display_name($1) as v", [name]);
  const nameOf = async (id: string) =>
    (await db.query<{ display_name: string | null }>("select display_name from public.profiles where id = $1", [id])).rows[0]
      ?.display_name ?? null;

  it("hata kaydı: istemcinin eski upsert'i (updated_at ile) satır varken bile yetki hatası alıyordu", async () => {
    const legacy = `insert into public.profiles (id, display_name, updated_at) values ($1, $2, now())
                    on conflict (id) do update set display_name = excluded.display_name, updated_at = excluded.updated_at`;
    expect(await run(as(SELLER), legacy, [SELLER, "Kamil"])).toMatchObject({ ok: false, code: "42501" });
    expect(await nameOf(SELLER)).toBeNull();
  });

  it("var olan profilde adı kaydeder, boşlukları düzeltir ve updated_at'i sunucu atar", async () => {
    await db.query("update public.profiles set updated_at = now() - interval '1 day' where id = $1", [SELLER]);
    expect(await setName(SELLER, "  Kamil   Oto  ")).toEqual({ ok: true, rows: [{ v: "Kamil Oto" }] });
    expect(await nameOf(SELLER)).toBe("Kamil Oto");
    const { rows } = await db.query<{ fresh: boolean }>(
      "select updated_at > now() - interval '1 minute' as fresh from public.profiles where id = $1",
      [SELLER],
    );
    expect(rows[0].fresh).toBe(true);
  });

  it("profil satırı olmayan kullanıcıda satırı açar", async () => {
    expect(await setName(NEWBIE, "Yeni Üye")).toMatchObject({ ok: true });
    expect(await nameOf(NEWBIE)).toBe("Yeni Üye");
  });

  it.each(["K", " ", "a".repeat(31), "<b>Kamil</b>", "Kamil\u0007"])("kurala uymayan ad reddedilir: %j", async (bad) => {
    expect(await setName(BUYER, bad)).toMatchObject({
      ok: false,
      code: "23514",
      message: "Ad 2–30 karakter olmalı; < ve > kullanılamaz.",
    });
  });

  it("yalnızca kendi adını değiştirir; misafir çağıramaz", async () => {
    await setName(SELLER, "Satıcı");
    await setName(BUYER, "Alıcı");
    expect(await nameOf(SELLER)).toBe("Satıcı");
    expect(await run(anon, "select public.update_profile_display_name('Hack')")).toMatchObject({ ok: false, code: "42501" });
    expect(await nameOf(SELLER)).toBe("Satıcı");
  });

  it("kullanıcı adı ve takip sayaçları olan profilde de çalışır", async () => {
    await setUsername(SELLER, "kamil");
    await follow(BUYER, SELLER);
    expect(await setName(SELLER, "Kamil C.")).toMatchObject({ ok: true });
    expect(await counts(SELLER)).toEqual({ followers_count: 1, following_count: 0 });
    expect(await usernameOf(SELLER)).toBe("kamil");
  });
});

describe("list_blocked_users", () => {
  it("yalnızca kendi engellediklerini ad ve kullanıcı adıyla, en yeni önce döner", async () => {
    await setUsername(OTHER, "diger");
    await run(as(OTHER), "select public.update_profile_display_name('Diğer Kişi')");
    await run(as(BUYER), "insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [BUYER, SELLER]);
    await run(as(BUYER), "insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [BUYER, OTHER]);
    await db.query("update public.user_blocks set created_at = now() - interval '1 day' where blocked_id = $1", [SELLER]);
    // Başkasının engeli listede görünmez
    await run(as(SELLER), "insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [SELLER, NEWBIE]);

    const list = await value<Record<string, unknown>[]>(as(BUYER), "select public.list_blocked_users() as v");
    expect(list.map((b) => b.id)).toEqual([OTHER, SELLER]);
    expect(list[0]).toMatchObject({ id: OTHER, username: "diger", display_name: "Diğer Kişi", avatar_url: null });
    expect(JSON.stringify(list)).not.toContain("905551112233");
    expect(await value(as(OTHER), "select public.list_blocked_users() as v")).toEqual([]);
  });

  it("misafir çağıramaz", async () => {
    expect(await run(anon, "select public.list_blocked_users()")).toMatchObject({ ok: false, code: "42501" });
  });
});

describe("profilden doğrudan mesaj (start_direct_conversation)", () => {
  const startDirect = (sub: string, target: string) =>
    run<{ v: string }>(as(sub), "select public.start_direct_conversation($1) as v", [target]);
  async function direct(sub: string, target: string): Promise<string> {
    const result = await startDirect(sub, target);
    if (!result.ok) throw new Error(result.message);
    return result.rows[0].v;
  }

  // Doğrudan mesajı başlatanın da kullanıcı adı olmalı (20260927200000)
  beforeEach(async () => {
    await setUsername(BUYER, "alici");
  });

  it("başlatanın kullanıcı adı yoksa açılmaz (önce kullanıcı adı belirlenmeli)", async () => {
    await setUsername(SELLER, "kamil");
    expect(await startDirect(OTHER, SELLER)).toMatchObject({
      ok: false,
      code: "23514",
      // Arayüz bu metni tanıyıp kullanıcı adı penceresini açar (lib/messages.ts ile aynı)
      message: DIRECT_USERNAME_REQUIRED,
    });
    expect((await db.query("select id from public.conversations")).rows).toEqual([]);
    await setUsername(OTHER, "diger");
    expect(await startDirect(OTHER, SELLER)).toMatchObject({ ok: true });
  });

  it("ilan olmadan konuşma açar: listing_id boş, başlatan buyer, profil sahibi seller", async () => {
    await setUsername(SELLER, "kamil");
    const id = await direct(BUYER, SELLER);
    const { rows } = await db.query("select listing_id, buyer_id, seller_id from public.conversations where id = $1", [id]);
    expect(rows).toEqual([{ listing_id: null, buyer_id: BUYER, seller_id: SELLER }]);
  });

  it("iki kişi arasında tek konuşma: tekrar ya da karşı taraf başlatınca aynı konuşma döner", async () => {
    await setUsername(SELLER, "kamil");
    await setUsername(BUYER, "alici");
    const first = await direct(BUYER, SELLER);
    expect(await direct(BUYER, SELLER)).toBe(first);
    expect(await direct(SELLER, BUYER)).toBe(first);
    expect((await db.query("select id from public.conversations")).rows).toHaveLength(1);
  });

  it("ilanlı konuşma ve doğrudan konuşma aynı iki kişi arasında ayrı ayrı var olabilir", async () => {
    await setUsername(SELLER, "kamil");
    const listing = await run<{ v: string }>(as(BUYER), "select public.start_conversation($1) as v", [ACTIVE]);
    expect(listing).toMatchObject({ ok: true });
    const directId = await direct(BUYER, SELLER);
    expect(listing.ok && listing.rows[0].v).not.toBe(directId);
    // Doğrudan konuşma tekilliği veritabanında da zorunlu
    expect(
      await run(service, "insert into public.conversations (listing_id, buyer_id, seller_id) values (null, $1, $2)", [SELLER, BUYER]),
    ).toMatchObject({ ok: false, code: "23505" });
  });

  it("kendine yazılamaz; misafir başlatamaz", async () => {
    await setUsername(BUYER, "alici");
    expect(await startDirect(BUYER, BUYER)).toMatchObject({ ok: false, code: "23514", message: "Kendine mesaj gönderemezsin." });
    expect(await run(anon, "select public.start_direct_conversation($1)", [SELLER])).toMatchObject({ ok: false, code: "42501" });
  });

  it("yalnızca kullanıcı adı (herkese açık profili) olan kişiye yazılır", async () => {
    // SELLER'ın kullanıcı adı yok (ilanı olsa da): profilden mesaj açılamaz
    expect(await startDirect(BUYER, SELLER)).toMatchObject({ ok: false, code: "P0002", message: "Kullanıcı bulunamadı." });
    expect(await startDirect(BUYER, "99999999-9999-4999-8999-999999999999")).toMatchObject({ ok: false, code: "P0002" });
  });

  it("engel varsa yeni konuşma açılmaz; mevcut konuşma döner ama mesaj gönderilemez", async () => {
    await setUsername(SELLER, "kamil");
    await setUsername(OTHER, "diger");
    await run(as(OTHER), "insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [OTHER, BUYER]);
    expect(await startDirect(BUYER, OTHER)).toMatchObject({
      ok: false,
      code: "42501",
      message: "Bu kullanıcıyla mesajlaşamazsın.",
    });

    const id = await direct(BUYER, SELLER);
    await run(as(SELLER), "insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [SELLER, BUYER]);
    expect(await direct(BUYER, SELLER)).toBe(id);
    expect(
      await run(as(BUYER), "insert into public.messages (conversation_id, sender_id, text) values ($1, $2, 'selam')", [id, BUYER]),
    ).toMatchObject({ ok: false, code: "42501" });
  });

  it("iki taraf yazar ve okur; üçüncü kişi göremez", async () => {
    await setUsername(SELLER, "kamil");
    const id = await direct(BUYER, SELLER);
    const send = (sub: string, text: string) =>
      run(as(sub), "insert into public.messages (conversation_id, sender_id, text) values ($1, $2, $3)", [id, sub, text]);
    expect(await send(BUYER, "Merhaba")).toMatchObject({ ok: true });
    expect(await send(SELLER, "Selam")).toMatchObject({ ok: true });
    expect(await send(OTHER, "Araya girdim")).toMatchObject({ ok: false, code: "42501" });
    expect(await run(as(OTHER), "select id from public.messages where conversation_id = $1", [id])).toEqual({ ok: true, rows: [] });
    expect(await run(as(OTHER), "select public.get_conversation($1)", [id])).toMatchObject({ ok: false, code: "P0002" });
  });

  it("get_conversation ve list_conversations türü ve karşı tarafın kullanıcı adını döner", async () => {
    await setUsername(SELLER, "kamil");
    await run(as(SELLER), "select public.update_profile_display_name('Kamil Oto')");
    const directId = await direct(BUYER, SELLER);
    const listing = await run<{ v: string }>(as(BUYER), "select public.start_conversation($1) as v", [ACTIVE]);
    const listingId = listing.ok ? listing.rows[0].v : "";

    const detail = await value<Record<string, unknown>>(as(BUYER), "select public.get_conversation($1) as v", [directId]);
    expect(detail).toMatchObject({
      kind: "direct",
      listing: null,
      partner: { id: SELLER, username: "kamil", display_name: "Kamil Oto", avatar_url: null },
    });
    expect(JSON.stringify(detail)).not.toContain("905551112233");
    expect(await value(as(BUYER), "select public.get_conversation($1) as v", [listingId])).toMatchObject({
      kind: "listing",
      listing: { id: ACTIVE },
    });

    const inbox = await value<Record<string, unknown>[]>(as(SELLER), "select public.list_conversations() as v");
    expect(inbox.map((c) => [c.id, c.kind]).sort()).toEqual(
      [
        [directId, "direct"],
        [listingId, "listing"],
      ].sort(),
    );
    expect(inbox.find((c) => c.id === directId)).toMatchObject({ listing: null, partner: { id: BUYER } });
  });

  it("spam sınırı: saatte en fazla 20 yeni doğrudan konuşma", async () => {
    await db.exec(`
      create temp table targets as select gen_random_uuid() as id, 'hedef_' || n as username from generate_series(1, 21) n;
      insert into auth.users select id from targets;
      insert into public.profiles (id, username) select id, username from targets;
      insert into public.conversations (listing_id, buyer_id, seller_id)
        select null, '${BUYER}', id from targets where username <> 'hedef_21';
    `);
    const last = (await db.query<{ id: string }>("select id from targets where username = 'hedef_21'")).rows[0].id;
    expect(await startDirect(BUYER, last)).toMatchObject({
      ok: false,
      code: "23514",
      message: "Çok fazla yeni sohbet başlattın; biraz sonra tekrar dene.",
    });
    await db.exec("update public.conversations set created_at = now() - interval '2 hours'");
    expect(await startDirect(BUYER, last)).toMatchObject({ ok: true });
    await db.exec("delete from auth.users where id in (select id from targets); drop table targets;");
  });

  it("ilanlı konuşma başlatma (start_conversation) değişmedi: ilan tekilliği sürüyor", async () => {
    const a = await run<{ v: string }>(as(BUYER), "select public.start_conversation($1) as v", [ACTIVE]);
    const b = await run<{ v: string }>(as(BUYER), "select public.start_conversation($1) as v", [ACTIVE]);
    expect(a.ok && b.ok && a.rows[0].v === b.rows[0].v).toBe(true);
    expect(await run(as(BUYER), "select public.start_conversation($1)", [ARCHIVED])).toMatchObject({ ok: false, code: "P0002" });
  });
});
