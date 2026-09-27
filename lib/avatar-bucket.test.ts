// avatars bucket'ı: 20260928110000_avatars_allow_png.sql gerçek bir Postgres'te
// (PGlite). storage.buckets, uzak veritabanındaki satırın (2026-09-27: 1 MB,
// webp/jpeg) asgari kopyasıdır.

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AVATAR_TYPES, MAX_AVATAR_BYTES } from "./avatar";

const MIGRATION = readFileSync("supabase/migrations/20260928110000_avatars_allow_png.sql", "utf8");

const STORAGE = `
  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
`;

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STORAGE);
  await db.exec(`insert into storage.buckets values ('avatars', 'avatars', true, 1048576, array['image/webp', 'image/jpeg'])`);
  await db.exec(MIGRATION);
}, 30_000);

afterAll(async () => {
  await db?.close();
});

describe("avatars bucket'ı", () => {
  it("PNG'ye de izin verir; boyut sınırı ve herkese açıklık değişmez", async () => {
    const { rows } = await db.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'avatars'");
    expect(rows[0]).toEqual({ public: true, file_size_limit: MAX_AVATAR_BYTES, allowed_mime_types: ["image/webp", "image/jpeg", "image/png"] });
  });

  it("izin verilen türler sunucunun kaydettiği türlerle aynı (lib/avatar.ts AVATAR_TYPES)", async () => {
    const { rows } = await db.query<{ allowed_mime_types: string[] }>(
      "select allowed_mime_types from storage.buckets where id = 'avatars'",
    );
    expect([...rows[0].allowed_mime_types].sort()).toEqual([...AVATAR_TYPES].sort());
  });

  it("tekrar uygulanabilir", async () => {
    await db.exec(MIGRATION);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from storage.buckets");
    expect(rows[0].n).toBe(1);
  });

  it("bucket yoksa hiçbir şey yapmadan durur", async () => {
    const empty = new PGlite();
    try {
      await empty.exec(STORAGE);
      await expect(empty.exec(MIGRATION)).rejects.toThrow(/avatars bucket/);
    } finally {
      await empty.close();
    }
  });
});
