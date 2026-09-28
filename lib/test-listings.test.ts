import { beforeEach, describe, expect, it, vi } from "vitest";

// Test (deneme) ilanları: /api/admin/test-listings (yetki, doğrulama), sunucudaki
// toplu silme (önce Cloudflare videoları ve Storage, sonra yalnızca medyası temizlenen
// is_test satırları), panel satırına dönüşüm ve istemci çağrıları.

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabase: {} }));
vi.mock("./cloudflare", () => ({ deleteStreamVideo: vi.fn() }));

const adminClient = { marker: "admin-client" };
vi.mock("./supabase-server", () => ({ getSupabaseAdmin: () => adminClient }));
vi.mock("./moderation-server", () => ({ authorizeAdmin: vi.fn() }));

const server = vi.hoisted(() => ({ fetchTestListingRows: vi.fn(), removeTestListings: vi.fn() }));
vi.mock("./test-listings-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./test-listings-server")>()),
  fetchTestListingRows: server.fetchTestListingRows,
  removeTestListings: server.removeTestListings,
}));

import { GET, POST } from "../app/api/admin/test-listings/route";
import { deleteAllTestListings, fetchTestListings, parseTestListingAction, toTestListing, type TestListingRow } from "./moderation";
import { authorizeAdmin } from "./moderation-server";

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";

const get = () => GET(new Request("https://gozuyle.com/api/admin/test-listings", { headers: { Authorization: "Bearer tok" } }));
const post = (body: unknown) =>
  POST(
    new Request("https://gozuyle.com/api/admin/test-listings", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.mocked(authorizeAdmin).mockReset().mockResolvedValue({ ok: true, userId: ADMIN_ID });
  server.fetchTestListingRows.mockReset().mockResolvedValue({ ok: true, items: [] });
  server.removeTestListings.mockReset().mockResolvedValue({ ok: true, deleted: 5, failures: [] });
});

describe("/api/admin/test-listings", () => {
  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
  ] as const)("yönetici değilse %s: listelenmez, silinmez", async (status, code) => {
    vi.mocked(authorizeAdmin).mockResolvedValue({ ok: false, status });
    for (const response of [await get(), await post({ action: "delete_all" })]) {
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    expect(server.fetchTestListingRows).not.toHaveBeenCalled();
    expect(server.removeTestListings).not.toHaveBeenCalled();
  });

  it("GET listeyi servis anahtarıyla okur; önbelleğe alınmaz; hata 500", async () => {
    server.fetchTestListingRows.mockResolvedValueOnce({ ok: true, items: [{ id: "v1" }] });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [{ id: "v1" }] });
    expect(server.fetchTestListingRows).toHaveBeenCalledWith(adminClient);

    server.fetchTestListingRows.mockResolvedValueOnce({ ok: false });
    expect((await get()).status).toBe(500);
  });

  it("POST yalnızca { action: 'delete_all' } kabul eder ve silinen sayıyı döner", async () => {
    for (const body of [{}, { action: "delete" }, "bozuk{"]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_action" } });
    }
    expect(server.removeTestListings).not.toHaveBeenCalled();

    const response = await post({ action: "delete_all" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 5, failures: [] });
    expect(server.removeTestListings).toHaveBeenCalledWith(adminClient);

    server.removeTestListings.mockResolvedValueOnce({ ok: false });
    expect((await post({ action: "delete_all" })).status).toBe(500);
  });
});

// PostgREST sorgu zinciri: her çağrı kaydedilir, await edilince sonuç döner
function queryChain(result: unknown) {
  const calls: [string, ...unknown[]][] = [];
  const proxy: unknown = new Proxy(() => {}, {
    get(_target, prop) {
      if (prop === "then") return (resolve: (value: unknown) => void) => resolve(result);
      return (...args: unknown[]) => {
        calls.push([String(prop), ...args]);
        return proxy;
      };
    },
  });
  return { proxy, calls };
}

describe("removeTestListings (sunucu)", async () => {
  const { removeTestListings, fetchTestListingRows } = await vi.importActual<typeof import("./test-listings-server")>("./test-listings-server");

  function fakeSupabase(listings: { id: string; videos: { stream_uid: string }[] }[], files: Record<string, string[]>) {
    const select = queryChain({ data: listings, error: null });
    const remove = queryChain({ data: listings.map(({ id }) => ({ id })), error: null });
    const tables = [select, remove];
    const storageRemove = vi.fn(async (paths: string[]) => ({ data: paths, error: null }));
    const client = {
      from: vi.fn(() => tables.shift()!.proxy),
      storage: {
        from: vi.fn(() => ({
          list: vi.fn(async (folder: string) => ({ data: (files[folder] ?? []).map((name) => ({ name })), error: null })),
          remove: storageRemove,
        })),
      },
    };
    return { client, select, remove, storageRemove };
  }

  it("videoları ve fotoğrafları siler, sonra yalnızca is_test satırlarını", async () => {
    const deleteVideo = vi.fn(async () => {});
    const fake = fakeSupabase(
      [
        { id: "v1", videos: [{ stream_uid: "cf-1" }] },
        { id: "v2", videos: [] },
      ],
      { v1: ["0.jpeg", "1.jpeg"], v2: [] },
    );
    const result = await removeTestListings(fake.client as never, { deleteVideo });

    expect(result).toEqual({ ok: true, deleted: 2, failures: [] });
    expect(fake.select.calls).toContainEqual(["eq", "is_test", true]);
    expect(deleteVideo).toHaveBeenCalledWith("cf-1");
    expect(fake.storageRemove).toHaveBeenCalledWith(["v1/0.jpeg", "v1/1.jpeg"]);
    expect(fake.remove.calls).toContainEqual(["delete"]);
    expect(fake.remove.calls).toContainEqual(["in", "id", ["v1", "v2"]]);
    expect(fake.remove.calls).toContainEqual(["eq", "is_test", true]);
  });

  it("videosu silinemeyen ilanın satırı kalır (yetim video olmaz), neden bildirilir", async () => {
    const deleteVideo = vi.fn(async (uid: string) => {
      if (uid === "cf-bad") throw new Error("503");
    });
    const fake = fakeSupabase(
      [
        { id: "v1", videos: [{ stream_uid: "cf-bad" }] },
        { id: "v2", videos: [{ stream_uid: "cf-ok" }] },
      ],
      {},
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await removeTestListings(fake.client as never, { deleteVideo });
    expect(fake.remove.calls).toContainEqual(["in", "id", ["v2"]]);
    expect(result).toMatchObject({ ok: true, failures: ["v1: video cf-bad"] });
  });

  it("test ilanı yoksa silme sorgusu atılmaz", async () => {
    const fake = fakeSupabase([], {});
    expect(await removeTestListings(fake.client as never, { deleteVideo: vi.fn() })).toEqual({ ok: true, deleted: 0, failures: [] });
    expect(fake.client.from).toHaveBeenCalledTimes(1);
  });

  it("liste yalnızca test ilanları, en yenisi önce", async () => {
    const chain = queryChain({ data: [], error: null });
    const client = { from: vi.fn(() => chain.proxy) };
    expect(await fetchTestListingRows(client as never)).toEqual({ ok: true, items: [] });
    expect(chain.calls).toContainEqual(["eq", "is_test", true]);
    expect(chain.calls).toContainEqual(["order", "created_at", { ascending: false }]);
  });
});

describe("panel satırı ve istemci", () => {
  const row: TestListingRow = {
    id: "v1",
    status: "active",
    year: 2019,
    price: "1450000",
    currency: "TRY",
    city: "İstanbul",
    created_at: "2026-09-28T10:00:00+00:00",
    brand: { name: "BMW" },
    model: { name: "3 Serisi" },
    videos: [{ stream_uid: "cf-1", thumbnail_url: "https://cf/thumb.jpg", status: "ready" }],
    vehicle_images: [
      { image_url: "https://photo/1.jpeg", is_primary: false, display_order: 1 },
      { image_url: "https://photo/0.jpeg", is_primary: true, display_order: 0 },
    ],
  };

  it("başlık, fiyat, kapak (önce video karesi, yoksa kapak fotoğrafı)", () => {
    expect(toTestListing(row)).toMatchObject({ title: "BMW 3 Serisi", price: 1_450_000, coverUrl: "https://cf/thumb.jpg", hasVideo: true });
    expect(toTestListing({ ...row, videos: [] })).toMatchObject({ coverUrl: "https://photo/0.jpeg", hasVideo: false });
  });

  it("istek doğrulaması", () => {
    expect(parseTestListingAction({ action: "delete_all" })).toEqual({ ok: true, value: { action: "delete_all" } });
    expect(parseTestListingAction(null)).toMatchObject({ ok: false });
  });

  it("istemci çağrıları yetki başlığıyla; hata mesajı sunucudan", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: 3, failures: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Bu sayfaya erişim yetkin yok." } }), { status: 403 }));
    expect(await fetchTestListings("tok", fetchImpl)).toEqual({ ok: true, items: [] });
    expect(fetchImpl.mock.calls[0]).toEqual([
      "/api/admin/test-listings",
      expect.objectContaining({ method: "GET", headers: expect.objectContaining({ Authorization: "Bearer tok" }) }),
    ]);
    expect(await deleteAllTestListings("tok", fetchImpl)).toEqual({ ok: true, deleted: 3, failures: [] });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ action: "delete_all" });
    expect(await deleteAllTestListings("tok", fetchImpl)).toEqual({ ok: false, status: 403, message: "Bu sayfaya erişim yetkin yok." });
  });
});
