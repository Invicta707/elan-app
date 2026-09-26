import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deleteAvatar, saveAvatar } from "./avatar-server";

const WEBP = new Uint8Array([..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBPVP8 "].map((c) => c.charCodeAt(0))));

type Fake = { uploadError?: unknown; upsertError?: unknown; existing?: string[] };

function fakeSupabase(fake: Fake = {}) {
  const log: string[] = [];
  const upserts: unknown[] = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _bytes: Uint8Array, options: { contentType: string }) => {
          log.push(`upload ${bucket}/${path} ${options.contentType}`);
          return { error: fake.uploadError ?? null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${path}` } }),
        list: async (prefix: string) => {
          log.push(`list ${bucket}/${prefix}`);
          return { data: (fake.existing ?? []).map((name) => ({ name })), error: null };
        },
        remove: async (paths: string[]) => {
          log.push(`remove ${bucket} ${paths.join(",")}`);
          return { error: null };
        },
      }),
    },
    from: (table: string) => ({
      upsert: async (row: unknown) => {
        log.push(`upsert ${table}`);
        upserts.push(row);
        return { error: fake.upsertError ?? null };
      },
    }),
  };
  return { supabase: client as unknown as SupabaseClient, log, upserts };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveAvatar", () => {
  it("yükler, profile yazar, eski dosyaları siler", async () => {
    const { supabase, log, upserts } = fakeSupabase({ existing: ["1600.webp", "1700.webp"] });
    const result = await saveAvatar(supabase, "u1", WEBP, 1700);

    expect(result).toEqual({ ok: true, avatarUrl: "https://cdn.test/avatars/u1/1700.webp" });
    expect(log).toEqual([
      "upload avatars/u1/1700.webp image/webp",
      "upsert profiles",
      "list avatars/u1",
      "remove avatars u1/1600.webp",
    ]);
    expect(upserts[0]).toMatchObject({ id: "u1", avatar_url: "https://cdn.test/avatars/u1/1700.webp" });
  });

  it("boş, çok büyük ya da tanınmayan dosya yüklenmez", async () => {
    const { supabase, log } = fakeSupabase();
    expect(await saveAvatar(supabase, "u1", new Uint8Array())).toMatchObject({ ok: false, status: 400 });
    expect(await saveAvatar(supabase, "u1", new Uint8Array(1024 * 1024 + 1))).toMatchObject({ ok: false, status: 413 });
    const svg = new TextEncoder().encode("<svg onload=alert(1)>");
    expect(await saveAvatar(supabase, "u1", svg)).toMatchObject({
      ok: false,
      status: 400,
      message: "Profil fotoğrafı WebP ya da JPEG olmalı.",
    });
    expect(log).toEqual([]);
  });

  it("profil yazılamazsa yüklenen dosya geri silinir", async () => {
    const { supabase, log } = fakeSupabase({ upsertError: { message: "db down" } });
    expect(await saveAvatar(supabase, "u1", WEBP, 1700)).toMatchObject({ ok: false, status: 500 });
    expect(log).toContain("remove avatars u1/1700.webp");
  });

  it("yükleme hatası", async () => {
    const { supabase, log } = fakeSupabase({ uploadError: { message: "storage down" } });
    expect(await saveAvatar(supabase, "u1", WEBP, 1700)).toMatchObject({ ok: false, status: 500 });
    expect(log).not.toContain("upsert profiles");
  });
});

describe("deleteAvatar", () => {
  it("profil adresini boşaltır ve klasörü temizler", async () => {
    const { supabase, log, upserts } = fakeSupabase({ existing: ["1700.webp"] });
    expect(await deleteAvatar(supabase, "u1")).toEqual({ ok: true, avatarUrl: null });
    expect(upserts[0]).toMatchObject({ id: "u1", avatar_url: null });
    expect(log).toEqual(["upsert profiles", "list avatars/u1", "remove avatars u1/1700.webp"]);
  });
});
