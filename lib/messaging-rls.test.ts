// Güvenlik testleri: profil yetkileri ve ilan üzerinden mesajlaşma.
//
// 20260926210000_profiles_and_messaging.sql gerçek bir Postgres'te (PGlite)
// çalıştırılır; istekler Supabase'deki gibi rol (set role) ve JWT claim'leriyle
// taklit edilir. BASE_SCHEMA, uzak veritabanındaki ilgili tanımların
// (2026-09-26) asgari kopyasıdır.

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const MIGRATION = readFileSync("supabase/migrations/20260926210000_profiles_and_messaging.sql", "utf8");

const SELLER = "11111111-1111-4111-8111-111111111111";
const BUYER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const BUYER2 = "44444444-4444-4444-8444-444444444444";
const ACTIVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ARCHIVED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
  insert into auth.users values ('${SELLER}'), ('${BUYER}'), ('${OTHER}'), ('${BUYER2}');

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
    status public.vehicle_status not null default 'draft'
  );
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

  insert into public.brands (id, name) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'BMW');
  insert into public.models (id, brand_id, name) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '3 Serisi');
  insert into public.vehicles (id, seller_id, brand_id, model_id, year, price, status) values
    ('${ACTIVE}', '${SELLER}', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 2020, 1250000, 'active'),
    ('${ARCHIVED}', '${SELLER}', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 2019, 900000, 'archived');
  insert into public.vehicle_images (vehicle_id, image_url, is_primary) values ('${ACTIVE}', 'https://x/cover.jpg', true);
  insert into public.profiles (id, whatsapp_number) values ('${SELLER}', '905551112233');
`;

type Actor = { role: "anon" | "authenticated"; sub?: string };
const as = (sub: string): Actor => ({ role: "authenticated", sub });
const anon: Actor = { role: "anon" };

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_SCHEMA);
  await db.exec(MIGRATION);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(
    "delete from public.user_reports; delete from public.user_blocks; delete from public.messages; delete from public.conversations;",
  );
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

const startConversation = (sub: string, listing = ACTIVE) =>
  run<{ v: string }>(as(sub), "select public.start_conversation($1) as v", [listing]);

async function conversation(buyer = BUYER): Promise<string> {
  const result = await startConversation(buyer);
  if (!result.ok) throw new Error(result.message);
  return result.rows[0].v;
}

const send = (sub: string, conversationId: string, text: string, senderId = sub) =>
  run(as(sub), "insert into public.messages (conversation_id, sender_id, text) values ($1, $2, $3) returning id, text", [
    conversationId,
    senderId,
    text,
  ]);

describe("profiles: herkese açık alanlar ve WhatsApp numarası", () => {
  it("WhatsApp numaraları toplu çekilemez: satırı yalnızca sahibi okur", async () => {
    expect(await run(anon, "select * from public.profiles")).toMatchObject({ ok: false, code: "42501" });
    expect(await run(as(BUYER), "select whatsapp_number from public.profiles")).toEqual({ ok: true, rows: [] });
    expect(await run(as(SELLER), "select whatsapp_number from public.profiles")).toEqual({
      ok: true,
      rows: [{ whatsapp_number: "905551112233" }],
    });
  });

  it("canlıdaki ilan verme akışının upsert'ü çalışmaya devam eder", async () => {
    const upsert = `insert into public.profiles (id, whatsapp_number) values ($1, $2)
                    on conflict (id) do update set id = excluded.id, whatsapp_number = excluded.whatsapp_number`;
    expect(await run(as(BUYER), upsert, [BUYER, "905550000000"])).toMatchObject({ ok: true });
    expect(await run(as(BUYER), upsert, [BUYER, "905559999999"])).toMatchObject({ ok: true });
    const { rows } = await db.query<{ whatsapp_number: string }>("select whatsapp_number from public.profiles where id = $1", [BUYER]);
    expect(rows[0].whatsapp_number).toBe("905559999999");
  });

  it("görünen ad yazılabilir ve kurala uymalı", async () => {
    const setName = "insert into public.profiles (id, display_name) values ($1, $2) on conflict (id) do update set display_name = excluded.display_name";
    expect(await run(as(OTHER), setName, [OTHER, "Kamil C."])).toMatchObject({ ok: true });
    for (const bad of ["K", " Kamil", "<b>Kamil", "a".repeat(31)]) {
      expect(await run(as(OTHER), setName, [OTHER, bad])).toMatchObject({ ok: false, code: "23514" });
    }
  });

  it("avatar adresini kullanıcı yazamaz (yalnızca sunucu)", async () => {
    expect(
      await run(as(BUYER2), "insert into public.profiles (id, avatar_url) values ($1, 'https://evil.example/x.png')", [BUYER2]),
    ).toMatchObject({ ok: false, code: "42501" });
    expect(
      await run(as(SELLER), "update public.profiles set avatar_url = 'https://evil.example/x.png' where id = $1", [SELLER]),
    ).toMatchObject({ ok: false, code: "42501" });
  });

  it("başkasının profili güncellenemez", async () => {
    const result = await run(as(BUYER), "update public.profiles set display_name = 'Hack' where id = $1 returning id", [SELLER]);
    expect(result).toEqual({ ok: true, rows: [] });
  });

  it("avatars bucket'ı: herkese açık, 1 MB, webp/jpeg", async () => {
    const { rows } = await db.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'avatars'");
    expect(rows[0]).toEqual({ public: true, file_size_limit: 1048576, allowed_mime_types: ["image/webp", "image/jpeg"] });
  });
});

describe("start_conversation", () => {
  it("yayındaki ilan için konuşma açar; ikinci çağrı aynı konuşmayı döner", async () => {
    const first = await conversation();
    expect(await conversation()).toBe(first);
    const { rows } = await db.query("select listing_id, buyer_id, seller_id from public.conversations");
    expect(rows).toEqual([{ listing_id: ACTIVE, buyer_id: BUYER, seller_id: SELLER }]);
  });

  it("kendi ilanına, yayında olmayan ilana ve giriş yapmadan açılamaz", async () => {
    expect(await startConversation(SELLER)).toMatchObject({ ok: false, message: "Kendi ilanına mesaj gönderemezsin." });
    expect(await startConversation(BUYER, ARCHIVED)).toMatchObject({ ok: false });
    expect(await run(anon, "select public.start_conversation($1)", [ACTIVE])).toMatchObject({ ok: false, code: "42501" });
  });

  it("iki yönden biri engellediyse açılamaz", async () => {
    await db.query("insert into public.user_blocks values ($1, $2)", [SELLER, BUYER]);
    expect(await startConversation(BUYER)).toMatchObject({ ok: false, message: "Bu kullanıcıyla mesajlaşamazsın." });
    await db.exec("delete from public.user_blocks");
    await db.query("insert into public.user_blocks values ($1, $2)", [BUYER, SELLER]);
    expect(await startConversation(BUYER)).toMatchObject({ ok: false });
  });

  it("konuşmalar doğrudan tabloya yazılamaz", async () => {
    expect(
      await run(as(BUYER), "insert into public.conversations (listing_id, buyer_id, seller_id) values ($1, $2, $3)", [
        ACTIVE,
        BUYER,
        SELLER,
      ]),
    ).toMatchObject({ ok: false, code: "42501" });
  });
});

describe("messages: yalnızca iki taraf", () => {
  it("alıcı ve satıcı yazar ve okur; mesaj kırpılır", async () => {
    const id = await conversation();
    expect(await send(BUYER, id, "  Merhaba, araç duruyor mu?  ")).toMatchObject({
      ok: true,
      rows: [{ text: "Merhaba, araç duruyor mu?" }],
    });
    expect(await send(SELLER, id, "Evet, duruyor.")).toMatchObject({ ok: true });
    for (const sub of [BUYER, SELLER]) {
      const read = await run(as(sub), "select text from public.messages where conversation_id = $1 order by created_at", [id]);
      expect(read.ok && read.rows).toHaveLength(2);
    }
  });

  it("üçüncü kişi okuyamaz ve yazamaz", async () => {
    const id = await conversation();
    await send(BUYER, id, "Merhaba");
    expect(await run(as(OTHER), "select * from public.messages")).toEqual({ ok: true, rows: [] });
    expect(await run(as(OTHER), "select * from public.conversations")).toEqual({ ok: true, rows: [] });
    expect(await send(OTHER, id, "Araya giriyorum")).toMatchObject({ ok: false, code: "42501" });
    expect(await run(anon, "select * from public.messages")).toMatchObject({ ok: false, code: "42501" });
  });

  it("başkası adına gönderilemez; okundu ve zaman damgası istemciden yazılamaz", async () => {
    const id = await conversation();
    expect(await send(BUYER, id, "Sahte", SELLER)).toMatchObject({ ok: false, code: "42501" });
    expect(
      await run(as(BUYER), "insert into public.messages (conversation_id, sender_id, text, is_read) values ($1, $2, 'x', true)", [
        id,
        BUYER,
      ]),
    ).toMatchObject({ ok: false, code: "42501" });
    expect(
      await run(as(BUYER), "insert into public.messages (conversation_id, sender_id, text, created_at) values ($1, $2, 'x', now() - interval '1 day')", [
        id,
        BUYER,
      ]),
    ).toMatchObject({ ok: false, code: "42501" });
  });

  it("mesajlar düzenlenemez ve silinemez", async () => {
    const id = await conversation();
    await send(BUYER, id, "Merhaba");
    expect(await run(as(BUYER), "update public.messages set text = 'değişti'")).toMatchObject({ ok: false, code: "42501" });
    expect(await run(as(SELLER), "update public.messages set is_read = true")).toMatchObject({ ok: false, code: "42501" });
    expect(await run(as(BUYER), "delete from public.messages")).toMatchObject({ ok: false, code: "42501" });
  });

  it("boş ya da çok uzun mesaj reddedilir", async () => {
    const id = await conversation();
    expect(await send(BUYER, id, "   ")).toMatchObject({ ok: false, code: "23514" });
    expect(await send(BUYER, id, "a".repeat(2001))).toMatchObject({ ok: false, code: "23514" });
  });

  it("engelden sonra iki yönden de mesaj gönderilemez; geçmiş okunabilir", async () => {
    const id = await conversation();
    await send(BUYER, id, "Merhaba");
    expect(await run(as(SELLER), "insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [SELLER, BUYER])).toMatchObject({
      ok: true,
    });
    expect(await send(BUYER, id, "Neden cevap vermiyorsun?")).toMatchObject({ ok: false, code: "42501" });
    expect(await send(SELLER, id, "...")).toMatchObject({ ok: false, code: "42501" });
    const history = await run(as(BUYER), "select text from public.messages");
    expect(history.ok && history.rows).toHaveLength(1);

    await run(as(SELLER), "delete from public.user_blocks where blocked_id = $1", [BUYER]);
    expect(await send(BUYER, id, "Tekrar merhaba")).toMatchObject({ ok: true });
  });

  it("gönderen başına dakikada 30 mesaj sınırı", async () => {
    const id = await conversation();
    await db.query(
      `insert into public.messages (conversation_id, sender_id, text) select $1, $2, 'm' || g from generate_series(1, 30) g`,
      [id, BUYER],
    );
    expect(await send(BUYER, id, "31")).toMatchObject({
      ok: false,
      message: "Çok hızlı mesaj gönderiyorsun; biraz bekleyip tekrar dene.",
    });
    expect(await send(SELLER, id, "Satıcı etkilenmez")).toMatchObject({ ok: true });
  });

  it("yeni mesaj konuşmayı öne alır (updated_at)", async () => {
    const id = await conversation();
    await db.query("update public.conversations set updated_at = now() - interval '1 day' where id = $1", [id]);
    await send(BUYER, id, "Merhaba");
    const { rows } = await db.query<{ fresh: boolean }>(
      "select updated_at > now() - interval '1 minute' as fresh from public.conversations where id = $1",
      [id],
    );
    expect(rows[0].fresh).toBe(true);
  });
});

describe("okundu bilgisi ve okunmamış sayısı", () => {
  it("gelen mesajları okundu yapar; kendi mesajlarına dokunmaz", async () => {
    const id = await conversation();
    await send(BUYER, id, "1");
    await send(BUYER, id, "2");
    await send(SELLER, id, "cevap");

    expect(await value<number>(as(SELLER), "select public.unread_message_count() as v")).toBe(2);
    expect(await value<number>(as(BUYER), "select public.unread_message_count() as v")).toBe(1);

    expect(await value<number>(as(SELLER), "select public.mark_conversation_read($1) as v", [id])).toBe(2);
    expect(await value<number>(as(SELLER), "select public.unread_message_count() as v")).toBe(0);
    expect(await value<number>(as(BUYER), "select public.unread_message_count() as v")).toBe(1);

    const { rows } = await db.query<{ text: string; is_read: boolean }>(
      "select text, is_read from public.messages order by created_at, text",
    );
    expect(rows.filter((r) => r.is_read).map((r) => r.text).sort()).toEqual(["1", "2"]);
  });

  it("katılımcı olmayan okundu yapamaz", async () => {
    const id = await conversation();
    await send(BUYER, id, "1");
    expect(await run(as(OTHER), "select public.mark_conversation_read($1)", [id])).toMatchObject({ ok: false });
    expect(await value<number>(as(OTHER), "select public.unread_message_count() as v")).toBe(0);
  });
});

describe("get_conversation / list_conversations", () => {
  it("ilan özeti, karşı taraf ve engel durumu", async () => {
    await db.query(
      "insert into public.profiles (id, display_name, avatar_url) values ($1, 'Ali Satıcı', 'https://x/a.webp') on conflict (id) do update set display_name = excluded.display_name, avatar_url = excluded.avatar_url",
      [SELLER],
    );
    const id = await conversation();
    const detail = await value<Record<string, unknown>>(as(BUYER), "select public.get_conversation($1) as v", [id]);
    expect(detail).toMatchObject({
      id,
      role: "buyer",
      listing: { id: ACTIVE, title: "BMW 3 Serisi 2020", price: 1250000, currency: "TRY", status: "active", cover_url: "https://x/cover.jpg" },
      partner: { id: SELLER, display_name: "Ali Satıcı", avatar_url: "https://x/a.webp" },
      i_blocked: false,
      blocked_me: false,
    });

    await db.query("insert into public.user_blocks values ($1, $2)", [SELLER, BUYER]);
    expect(await value<Record<string, unknown>>(as(BUYER), "select public.get_conversation($1) as v", [id])).toMatchObject({
      i_blocked: false,
      blocked_me: true,
    });
    expect(await run(as(OTHER), "select public.get_conversation($1)", [id])).toMatchObject({ ok: false });
  });

  it("gelen kutusu: son mesaj ve okunmamış sayısı, yalnızca kendi konuşmaları", async () => {
    const first = await conversation(BUYER);
    const second = await conversation(BUYER2);
    await send(BUYER, first, "ilk");
    await send(BUYER2, second, "ikinci");
    await send(BUYER2, second, "ikinci-2");

    const inbox = await value<{ id: string; unread: number; last_message: { text: string } }[]>(
      as(SELLER),
      "select public.list_conversations() as v",
    );
    expect(inbox.map((c) => [c.id, c.last_message.text, c.unread])).toEqual([
      [second, "ikinci-2", 2],
      [first, "ilk", 1],
    ]);
    expect(await value<unknown[]>(as(BUYER), "select public.list_conversations() as v")).toHaveLength(1);
    expect(await value<unknown[]>(as(OTHER), "select public.list_conversations() as v")).toEqual([]);
  });
});

describe("engeller ve kullanıcı şikayetleri", () => {
  it("yalnızca kendi engellerini görür ve yönetir", async () => {
    await db.query("insert into public.user_blocks values ($1, $2)", [SELLER, BUYER]);
    expect(await run(as(BUYER), "select * from public.user_blocks")).toEqual({ ok: true, rows: [] });
    expect(
      await run(as(BUYER), "insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [SELLER, OTHER]),
    ).toMatchObject({ ok: false, code: "42501" });
    expect(await run(as(BUYER), "delete from public.user_blocks returning blocker_id")).toEqual({ ok: true, rows: [] });
    expect(await run(as(BUYER), "select public.fn_blocked_with($1) as blocked", [SELLER])).toEqual({
      ok: true,
      rows: [{ blocked: true }],
    });
  });

  it("şikayet eklenir, okunamaz; açık şikayet tekrarlanamaz", async () => {
    const id = await conversation();
    const report = `insert into public.user_reports (reporter_id, reported_user_id, conversation_id, reason, details)
                    values ($1, $2, $3, 'harassment', 'Hakaret etti')`;
    expect(await run(as(BUYER), report, [BUYER, SELLER, id])).toMatchObject({ ok: true });
    expect(await run(as(BUYER), report, [BUYER, SELLER, id])).toMatchObject({ ok: false, code: "23505" });
    expect(await run(as(BUYER), "select * from public.user_reports")).toMatchObject({ ok: false, code: "42501" });
    expect(await run(as(BUYER), report, [OTHER, SELLER, id])).toMatchObject({ ok: false, code: "42501" });
    expect(
      await run(as(BUYER), "insert into public.user_reports (reporter_id, reported_user_id, reason) values ($1, $2, 'kötü')", [
        BUYER,
        OTHER,
      ]),
    ).toMatchObject({ ok: false, code: "23514" });
  });
});

describe("Realtime", () => {
  it("messages tablosu supabase_realtime yayınında", async () => {
    const { rows } = await db.query<{ tablename: string }>(
      "select tablename from pg_publication_tables where pubname = 'supabase_realtime'",
    );
    expect(rows.map((r) => r.tablename)).toEqual(["messages"]);
  });
});
