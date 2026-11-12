import { beforeEach, describe, expect, it, vi } from "vitest";

// /hatunum aç/kapa, sunucu tarafı:
// - lib/hatunum-switch.ts: bayrağın okunması/yazılması (varsayılan KAPALI)
// - app/api/admin/hatunum/route.ts: yalnızca yönetici okur/değiştirir
// - app/hatunum/page.tsx ve app/hatunum/foto/route.ts: kapalıyken 404
// Sayfanın etkileşimi lib/hatunum.test.tsx'te.

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabase: {} }));

const adminClient = { marker: "admin-client" };
vi.mock("./supabase-server", () => ({ getSupabaseAdmin: () => adminClient }));
vi.mock("./moderation-server", () => ({ authorizeAdmin: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));
vi.mock("next/font/google", () => ({ JetBrains_Mono: () => ({ variable: "mono-font" }) }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { GET, POST } from "../app/api/admin/hatunum/route";
import { GET as getPhoto } from "../app/hatunum/foto/route";
import HatunumPage, { generateMetadata } from "../app/hatunum/page";
import { HATUNUM_ENABLED_KEY, isHatunumEnabled, parseHatunumBody, setHatunumEnabled } from "./hatunum-switch";
import { authorizeAdmin } from "./moderation-server";

type ReadResult = { data: { value: unknown } | null; error: { message: string } | null };

/** from("app_settings").select().eq().maybeSingle() ve .upsert() zincirinin taklidi */
function fakeClient(read: ReadResult, writeError: { message: string } | null = null) {
  const calls = { from: [] as string[], eq: [] as unknown[][], upsert: [] as unknown[][] };
  const client = {
    from(table: string) {
      calls.from.push(table);
      return {
        select: () => ({
          eq: (...args: unknown[]) => {
            calls.eq.push(args);
            return { maybeSingle: async () => read };
          },
        }),
        upsert: async (...args: unknown[]) => {
          calls.upsert.push(args);
          return { error: writeError };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

/** Sunucu istemcisi (getSupabaseAdmin) bayrağı bu değerle okusun */
function setFlag(value: unknown) {
  const { client, calls } = fakeClient(value === undefined ? { data: null, error: null } : { data: { value }, error: null });
  Object.assign(adminClient, { from: (client as unknown as { from: (t: string) => unknown }).from });
  return calls;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("isHatunumEnabled", () => {
  it("yalnızca hatunum_enabled = true açar", async () => {
    const { client, calls } = fakeClient({ data: { value: true }, error: null });
    expect(await isHatunumEnabled(() => client)).toBe(true);
    expect(calls.from).toEqual(["app_settings"]);
    expect(calls.eq).toEqual([["key", HATUNUM_ENABLED_KEY]]);
    for (const value of [false, "true", 1, null]) {
      expect(await isHatunumEnabled(() => fakeClient({ data: { value }, error: null }).client)).toBe(false);
    }
  });

  it("varsayılan KAPALI: satır yok, okuma hatası ya da istemci yok", async () => {
    expect(await isHatunumEnabled(() => fakeClient({ data: null, error: null }).client)).toBe(false);
    expect(await isHatunumEnabled(() => fakeClient({ data: null, error: { message: "boom" } }).client)).toBe(false);
    expect(
      await isHatunumEnabled(() => {
        throw new Error("env eksik");
      }),
    ).toBe(false);
  });
});

describe("parseHatunumBody / setHatunumEnabled", () => {
  it("yalnızca { enabled: boolean } kabul edilir", () => {
    expect(parseHatunumBody({ enabled: true })).toEqual({ ok: true, enabled: true });
    expect(parseHatunumBody({ enabled: false })).toEqual({ ok: true, enabled: false });
    for (const body of [null, "x", {}, { enabled: "true" }, { disabled: true }]) {
      expect(parseHatunumBody(body)).toEqual({ ok: false });
    }
  });

  it("anahtarı yöneticinin kimliğiyle upsert eder; hata ok: false", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    expect(await setHatunumEnabled(client, true, "admin-1")).toEqual({ ok: true });
    expect(calls.upsert[0][0]).toMatchObject({ key: HATUNUM_ENABLED_KEY, value: true, updated_by: "admin-1" });
    expect(calls.upsert[0][1]).toEqual({ onConflict: "key" });
    expect(await setHatunumEnabled(fakeClient({ data: null, error: null }, { message: "x" }).client, true, "a")).toEqual({
      ok: false,
    });
  });
});

describe("/api/admin/hatunum", () => {
  const request = (method: "GET" | "POST", body?: unknown) =>
    new Request("https://gozuyle.com/api/admin/hatunum", {
      method,
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });

  beforeEach(() => vi.mocked(authorizeAdmin).mockReset());

  it("oturum yoksa 401, yönetici değilse 403; okunmaz, yazılmaz", async () => {
    const calls = setFlag(true);
    vi.mocked(authorizeAdmin).mockResolvedValue({ ok: false, status: 401 });
    expect((await GET(request("GET"))).status).toBe(401);
    expect((await POST(request("POST", { enabled: true }))).status).toBe(401);
    vi.mocked(authorizeAdmin).mockResolvedValue({ ok: false, status: 403 });
    expect((await GET(request("GET"))).status).toBe(403);
    expect((await POST(request("POST", { enabled: true }))).status).toBe(403);
    expect(calls.from).toEqual([]);
  });

  it("GET durumu verir (varsayılan kapalı)", async () => {
    vi.mocked(authorizeAdmin).mockResolvedValue({ ok: true, userId: "admin-1" });
    setFlag(undefined);
    const response = await GET(request("GET"));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ enabled: false });
    setFlag(true);
    expect(await (await GET(request("GET"))).json()).toEqual({ enabled: true });
  });

  it("POST açar/kapatır; bozuk gövde 400, yazma hatası 500", async () => {
    vi.mocked(authorizeAdmin).mockResolvedValue({ ok: true, userId: "admin-1" });
    const calls = setFlag(undefined);
    const opened = await POST(request("POST", { enabled: true }));
    expect(await opened.json()).toEqual({ enabled: true });
    expect(calls.upsert[0][0]).toMatchObject({ key: HATUNUM_ENABLED_KEY, value: true, updated_by: "admin-1" });
    expect(await (await POST(request("POST", { enabled: false }))).json()).toEqual({ enabled: false });

    for (const body of ["{", {}, { enabled: "1" }]) expect((await POST(request("POST", body))).status).toBe(400);

    const { client } = fakeClient({ data: null, error: null }, { message: "boom" });
    Object.assign(adminClient, { from: (client as unknown as { from: (t: string) => unknown }).from });
    expect((await POST(request("POST", { enabled: true }))).status).toBe(500);
  });
});

describe("app/hatunum/page.tsx ve /hatunum/foto", () => {
  it("kapalıyken (satır yok ya da false) sayfa notFound(), fotoğraf 404", async () => {
    for (const value of [undefined, false]) {
      setFlag(value);
      await expect(HatunumPage()).rejects.toThrow("NEXT_NOT_FOUND");
      // 404 yanıtına gömülen başlık/açıklama isim içermez
      expect(JSON.stringify(await generateMetadata())).not.toMatch(/Zülal|Z\u00fclal/);
      const photo = await getPhoto();
      expect(photo.status).toBe(404);
      expect(photo.headers.get("Content-Type")).not.toBe("image/jpeg");
    }
  });

  it("açıkken sayfa çizilir, fotoğraf önbelleğe alınmadan verilir", async () => {
    setFlag(true);
    const page = await HatunumPage();
    expect(page.props.className).toBe("mono-font");
    expect((await generateMetadata()).title).toBe("Zülal ❤️");
    const photo = await getPhoto();
    expect(photo.status).toBe(200);
    expect(photo.headers.get("Content-Type")).toBe("image/jpeg");
    expect(photo.headers.get("Cache-Control")).toBe("private, no-store");
    const bytes = new Uint8Array(await photo.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  });
});
