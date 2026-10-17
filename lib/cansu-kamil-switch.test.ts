import { beforeEach, describe, expect, it, vi } from "vitest";

// /cansu-kamil kapatma düğmesi (kill-switch), sunucu tarafı:
// - lib/cansu-kamil-switch.ts: ?admin=kamil denetimi, bayrağın okunması/yazılması
// - app/api/admin/cansu-kamil/route.ts: yalnızca yönetici kapatır/açar
// - app/cansu-kamil/page.tsx: bayrak açıksa herkese notFound() (404)
// Düğmenin kendisi lib/cansu-kamil.test.tsx'te; tablo ve yetkiler
// lib/app-settings-rls.test.ts'te.

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

import type { SupabaseClient } from "@supabase/supabase-js";
import { POST } from "../app/api/admin/cansu-kamil/route";
import CansuKamilPage from "../app/cansu-kamil/page";
import {
  CANSU_DISABLED_KEY,
  isCansuPageDisabled,
  parseKillSwitchBody,
  setCansuPageDisabled,
  shouldShowKillSwitch,
} from "./cansu-kamil-switch";
import { authorizeAdmin } from "./moderation-server";

type ReadResult = { data: { value: unknown } | null; error: { message: string } | null };

/** from("app_settings").select().eq().maybeSingle() ve .upsert() zincirinin taklidi */
function fakeClient(read: ReadResult | (() => never), writeError: { message: string } | null = null) {
  const calls = { from: [] as string[], eq: [] as unknown[][], upsert: [] as unknown[][] };
  const client = {
    from(table: string) {
      calls.from.push(table);
      return {
        select: () => ({
          eq: (...args: unknown[]) => {
            calls.eq.push(args);
            return { maybeSingle: async () => (typeof read === "function" ? read() : read) };
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

describe("shouldShowKillSwitch", () => {
  it("yalnızca ?admin=kamil'de görünür", () => {
    expect(shouldShowKillSwitch("kamil")).toBe(true);
    expect(shouldShowKillSwitch(["x", "kamil"])).toBe(true);
    for (const value of [undefined, "", "Kamil", "kamil ", "admin", ["x"]]) {
      expect(shouldShowKillSwitch(value)).toBe(false);
    }
  });
});

describe("parseKillSwitchBody", () => {
  it("yalnızca { disabled: boolean } kabul edilir", () => {
    expect(parseKillSwitchBody({ disabled: true })).toEqual({ ok: true, disabled: true });
    expect(parseKillSwitchBody({ disabled: false })).toEqual({ ok: true, disabled: false });
    for (const body of [null, undefined, "x", {}, { disabled: "true" }, { disabled: 1 }]) {
      expect(parseKillSwitchBody(body)).toEqual({ ok: false });
    }
  });
});

describe("isCansuPageDisabled", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("app_settings'teki cansu_kamil_disabled satırını okur; yalnızca true kapatır", async () => {
    const { client, calls } = fakeClient({ data: { value: true }, error: null });
    expect(await isCansuPageDisabled(() => client)).toBe(true);
    expect(calls.from).toEqual(["app_settings"]);
    expect(calls.eq).toEqual([["key", CANSU_DISABLED_KEY]]);

    for (const value of [false, "true", 1, null]) {
      expect(await isCansuPageDisabled(() => fakeClient({ data: { value }, error: null }).client)).toBe(false);
    }
  });

  it("satır yoksa, okuma hatasında ya da istemci oluşturulamazsa sayfa açık kalır", async () => {
    expect(await isCansuPageDisabled(() => fakeClient({ data: null, error: null }).client)).toBe(false);
    expect(await isCansuPageDisabled(() => fakeClient({ data: null, error: { message: "relation does not exist" } }).client)).toBe(false);
    expect(
      await isCansuPageDisabled(() => {
        throw new Error("env eksik");
      }),
    ).toBe(false);
  });
});

describe("setCansuPageDisabled", () => {
  it("anahtarı yöneticinin kimliğiyle upsert eder", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    expect(await setCansuPageDisabled(client, true, "admin-1")).toEqual({ ok: true });
    expect(calls.from).toEqual(["app_settings"]);
    const [row, options] = calls.upsert[0] as [Record<string, unknown>, unknown];
    expect(row).toMatchObject({ key: CANSU_DISABLED_KEY, value: true, updated_by: "admin-1" });
    expect(typeof row.updated_at).toBe("string");
    expect(options).toEqual({ onConflict: "key" });
  });

  it("yazma hatası ok: false döner", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ data: null, error: null }, { message: "boom" });
    expect(await setCansuPageDisabled(client, true, "admin-1")).toEqual({ ok: false });
  });
});

describe("POST /api/admin/cansu-kamil", () => {
  const post = (body: unknown) =>
    POST(
      new Request("https://gozuyle.com/api/admin/cansu-kamil", {
        method: "POST",
        headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );

  let upserts: unknown[][] = [];
  beforeEach(() => {
    vi.mocked(authorizeAdmin).mockReset();
    vi.spyOn(console, "info").mockImplementation(() => {});
    upserts = [];
    Object.assign(adminClient, {
      from: () => ({
        upsert: async (...args: unknown[]) => {
          upserts.push(args);
          return { error: null };
        },
      }),
    });
  });

  it("oturum yoksa 401, yönetici değilse 403; bayrak yazılmaz", async () => {
    vi.mocked(authorizeAdmin).mockResolvedValue({ ok: false, status: 401 });
    const unauthorized = await post({ disabled: true });
    expect(unauthorized.status).toBe(401);
    expect((await unauthorized.json()).error.code).toBe("unauthorized");

    vi.mocked(authorizeAdmin).mockResolvedValue({ ok: false, status: 403 });
    const forbidden = await post({ disabled: true });
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe("forbidden");
    expect(upserts).toEqual([]);
  });

  it("bozuk gövde 400", async () => {
    vi.mocked(authorizeAdmin).mockResolvedValue({ ok: true, userId: "admin-1" });
    for (const body of ["{", { disabled: "yes" }, {}]) {
      const response = await post(body);
      expect(response.status).toBe(400);
    }
    expect(upserts).toEqual([]);
  });

  it("yönetici sayfayı kapatır ve yeniden açabilir", async () => {
    vi.mocked(authorizeAdmin).mockResolvedValue({ ok: true, userId: "admin-1" });
    const closed = await post({ disabled: true });
    expect(closed.status).toBe(200);
    expect(closed.headers.get("Cache-Control")).toBe("no-store");
    expect(await closed.json()).toEqual({ disabled: true });
    expect(upserts[0][0]).toMatchObject({ key: CANSU_DISABLED_KEY, value: true, updated_by: "admin-1" });

    const reopened = await post({ disabled: false });
    expect(await reopened.json()).toEqual({ disabled: false });
    expect(upserts[1][0]).toMatchObject({ value: false });
  });

  it("veritabanı yazamazsa 500", async () => {
    vi.mocked(authorizeAdmin).mockResolvedValue({ ok: true, userId: "admin-1" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.assign(adminClient, { from: () => ({ upsert: async () => ({ error: { message: "boom" } }) }) });
    const response = await post({ disabled: true });
    expect(response.status).toBe(500);
  });
});

describe("app/cansu-kamil/page.tsx", () => {
  function setFlag(value: unknown) {
    Object.assign(adminClient, {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value }, error: null }) }) }) }),
    });
  }
  const render = (searchParams: Record<string, string | string[] | undefined>) =>
    CansuKamilPage({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) } as PageProps<"/cansu-kamil">);

  it("kapatıldıysa herkese (yöneticiye de) notFound()", async () => {
    setFlag(true);
    await expect(render({})).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(render({ admin: "kamil" })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("açıkken düğme yalnızca ?admin=kamil'de istenir", async () => {
    setFlag(false);
    expect((await render({})).props).toEqual({ showKillSwitch: false });
    expect((await render({ admin: "x" })).props).toEqual({ showKillSwitch: false });
    expect((await render({ admin: "kamil" })).props).toEqual({ showKillSwitch: true });
  });
});
