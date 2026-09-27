import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabase: {} }));

const getUserById = vi.fn();
vi.mock("./supabase-server", () => ({
  getAuthenticatedUserId: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  getSupabaseAdmin: () => ({ auth: { admin: { getUserById } } }),
}));

import {
  PENDING_LISTING_SELECT,
  PENDING_QUEUE_FILTER,
  authorizeAdmin,
  checkAdminStatus,
  dismissReports,
  fetchAdminCounts,
  fetchModerationQueueRows,
  fetchPendingListingRows,
  removeListing,
} from "./moderation-server";
import { getAuthenticatedUser, getAuthenticatedUserId } from "./supabase-server";

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const VEHICLE = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-09-26T12:00:00Z");
const ADMINS = new Set(["admin@gozuyle.com"]);

const request = new Request("https://gozuyle.com/api/admin/reports", {
  headers: { Authorization: "Bearer tok" },
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getAuthenticatedUserId).mockReset().mockResolvedValue(ADMIN_ID);
  vi.mocked(getAuthenticatedUser).mockReset().mockResolvedValue({ id: ADMIN_ID, email: "admin@gozuyle.com" });
  getUserById.mockReset().mockResolvedValue({
    data: { user: { id: ADMIN_ID, email: "Admin@Gozuyle.com", email_confirmed_at: "2026-09-01T00:00:00Z" } },
    error: null,
  });
});

describe("authorizeAdmin", () => {
  it("listedeki onaylı e-posta yönetici sayılır (büyük/küçük harf önemsiz)", async () => {
    expect(await authorizeAdmin(request, ADMINS)).toEqual({ ok: true, userId: ADMIN_ID });
    expect(getUserById).toHaveBeenCalledWith(ADMIN_ID);
  });

  it("oturum yoksa 401", async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(null);
    expect(await authorizeAdmin(request, ADMINS)).toEqual({ ok: false, status: 401 });
  });

  it("ADMIN_EMAILS boşsa kimse yönetici değildir; Auth'a sorulmaz", async () => {
    expect(await authorizeAdmin(request, new Set())).toEqual({ ok: false, status: 403 });
    expect(getUserById).not.toHaveBeenCalled();
  });

  it("listede olmayan, onaysız, yasaklı ya da okunamayan kullanıcı 403", async () => {
    const cases = [
      { user: { email: "baska@ornek.com", email_confirmed_at: "2026-09-01T00:00:00Z" } },
      { user: { email: "admin@gozuyle.com", email_confirmed_at: null } },
      { user: { email: "admin@gozuyle.com", email_confirmed_at: "x", banned_until: "2999-01-01T00:00:00Z" } },
      { user: { email: undefined, email_confirmed_at: "2026-09-01T00:00:00Z" } },
    ];
    for (const data of cases) {
      getUserById.mockResolvedValueOnce({ data, error: null });
      expect(await authorizeAdmin(request, ADMINS)).toEqual({ ok: false, status: 403 });
    }
    getUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: "User not found" } });
    expect(await authorizeAdmin(request, ADMINS)).toEqual({ ok: false, status: 403 });
  });

  it("süresi geçmiş yasak engel değildir", async () => {
    getUserById.mockResolvedValueOnce({
      data: { user: { email: "admin@gozuyle.com", email_confirmed_at: "x", banned_until: "2020-01-01T00:00:00Z" } },
      error: null,
    });
    expect(await authorizeAdmin(request, ADMINS)).toEqual({ ok: true, userId: ADMIN_ID });
  });
});

describe("checkAdminStatus (yönetim girişi)", () => {
  it("token'daki e-posta listede değilse yönetici değil; Auth'a hiç sorulmaz (ucuz)", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: "u1", email: "satici@ornek.com" });
    expect(await checkAdminStatus(request, ADMINS)).toEqual({ status: 200, admin: false });
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: "u1", email: null });
    expect(await checkAdminStatus(request, ADMINS)).toEqual({ status: 200, admin: false });
    expect(await checkAdminStatus(request, new Set())).toEqual({ status: 200, admin: false });
    expect(getUserById).not.toHaveBeenCalled();
  });

  it("listedeyse Auth'taki güncel kayıt denetlenir: onaylı e-posta yönetici", async () => {
    expect(await checkAdminStatus(request, ADMINS)).toEqual({ status: 200, admin: true, userId: ADMIN_ID });
    expect(getUserById).toHaveBeenCalledWith(ADMIN_ID);
  });

  it("token'daki e-posta yetki vermez: Auth'ta başka, onaysız ya da yasaklıysa yönetici değil", async () => {
    for (const user of [
      { email: "baska@ornek.com", email_confirmed_at: "2026-09-01T00:00:00Z" },
      { email: "admin@gozuyle.com", email_confirmed_at: null },
      { email: "admin@gozuyle.com", email_confirmed_at: "2026-09-01T00:00:00Z", banned_until: "2999-01-01T00:00:00Z" },
    ]) {
      getUserById.mockResolvedValueOnce({ data: { user: { id: ADMIN_ID, ...user } }, error: null });
      expect(await checkAdminStatus(request, ADMINS)).toEqual({ status: 200, admin: false });
    }
  });

  it("oturum yoksa 401", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
    expect(await checkAdminStatus(request, ADMINS)).toEqual({ status: 401 });
  });
});

// PostgREST sorgu zincirinin taklidi: her tablo çağrısındaki adımlar kaydedilir,
// sonuç tablo başına sırayla verilir.
type Result = { data: unknown; error: unknown; count?: number | null };

function fakeSupabase(results: Record<string, Result[]>) {
  const calls: { table: string; steps: unknown[][] }[] = [];
  const from = (table: string) => {
    const call = { table, steps: [] as unknown[][] };
    calls.push(call);
    const builder: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, property: string) {
          if (property === "then") {
            const result = results[table]?.shift() ?? { data: null, error: new Error(`beklenmeyen sorgu: ${table}`) };
            return (resolve: (value: Result) => void) => resolve(result);
          }
          return (...args: unknown[]) => {
            call.steps.push([property, ...args]);
            return builder;
          };
        },
      },
    );
    return builder;
  };
  return { supabase: { from } as unknown as SupabaseClient, calls };
}

describe("removeListing", () => {
  it("ilanı rejected yapar, sonra ilanın açık bildirimlerini reviewed olarak kapatır", async () => {
    const { supabase, calls } = fakeSupabase({
      vehicles: [{ data: [{ id: VEHICLE }], error: null }],
      reports: [{ data: [{ id: "r1" }, { id: "r2" }], error: null }],
    });

    expect(await removeListing(supabase, VEHICLE, ADMIN_ID, NOW)).toEqual({ ok: true, resolved: 2 });
    expect(calls).toEqual([
      {
        table: "vehicles",
        steps: [["update", { status: "rejected" }], ["eq", "id", VEHICLE], ["select", "id"]],
      },
      {
        table: "reports",
        steps: [
          ["update", { status: "reviewed", resolved_at: NOW.toISOString(), resolved_by: ADMIN_ID }],
          ["eq", "status", "open"],
          ["eq", "vehicle_id", VEHICLE],
          ["select", "id"],
        ],
      },
    ]);
  });

  it("ilan yoksa bildirimlere dokunmaz", async () => {
    const { supabase, calls } = fakeSupabase({ vehicles: [{ data: [], error: null }] });
    expect(await removeListing(supabase, VEHICLE, ADMIN_ID, NOW)).toEqual({ ok: false, code: "vehicle_not_found" });
    expect(calls.map((c) => c.table)).toEqual(["vehicles"]);
  });

  it("veritabanı hatası", async () => {
    const failing = fakeSupabase({ vehicles: [{ data: null, error: { message: "boom" } }] });
    expect(await removeListing(failing.supabase, VEHICLE, ADMIN_ID, NOW)).toEqual({
      ok: false,
      code: "database_error",
    });

    const reportsFail = fakeSupabase({
      vehicles: [{ data: [{ id: VEHICLE }], error: null }],
      reports: [{ data: null, error: { message: "boom" } }],
    });
    expect(await removeListing(reportsFail.supabase, VEHICLE, ADMIN_ID, NOW)).toEqual({
      ok: false,
      code: "database_error",
    });
  });
});

describe("dismissReports", () => {
  it("yalnızca verilen açık bildirimleri dismissed yapar; ilana dokunmaz", async () => {
    const { supabase, calls } = fakeSupabase({ reports: [{ data: [{ id: "r1" }], error: null }] });

    expect(await dismissReports(supabase, ["r1", "r2"], ADMIN_ID, NOW)).toEqual({ ok: true, resolved: 1 });
    expect(calls).toEqual([
      {
        table: "reports",
        steps: [
          ["update", { status: "dismissed", resolved_at: NOW.toISOString(), resolved_by: ADMIN_ID }],
          ["eq", "status", "open"],
          ["in", "id", ["r1", "r2"]],
          ["select", "id"],
        ],
      },
    ]);
  });
});

describe("fetchPendingListingRows (içerik denetimi kuyruğu)", () => {
  it("karar bekleyen bütün ilanlar: denetimdeki, onay bekleyen ve arşive alınmış olanlar; en eskisi önce", async () => {
    const { supabase, calls } = fakeSupabase({ vehicles: [{ data: [], error: null }] });
    expect(await fetchPendingListingRows(supabase)).toEqual({ ok: true, items: [] });
    expect(calls).toEqual([
      {
        table: "vehicles",
        steps: [
          ["select", PENDING_LISTING_SELECT],
          ["eq", "moderation_status", "pending"],
          ["or", "status.in.(pending_moderation,pending_approval),moderation_reason.not.is.null"],
          ["order", "created_at", { ascending: true }],
          ["limit", 200],
        ],
      },
    ]);
  });

  it("okunamazsa ok: false", async () => {
    const { supabase } = fakeSupabase({ vehicles: [{ data: null, error: { message: "boom" } }] });
    expect(await fetchPendingListingRows(supabase)).toEqual({ ok: false });
  });

  const pendingRow = (id: string, sellerId: string) => ({
    id,
    seller_id: sellerId,
    status: "pending_approval",
    moderation_status: "pending",
    moderation_reason: "ai:safe",
    description: null,
    year: 2020,
    price: 100,
    currency: "TRY",
    mileage_km: 1,
    city: "İzmir",
    created_at: "2026-09-28T09:00:00Z",
    views_count: 0,
    brand: { name: "Fiat" },
    model: { name: "Egea" },
    images: [],
    videos: [],
  });

  it("satıcıların kullanıcı adları tek sorguyla eklenir (yinelenen satıcı bir kez)", async () => {
    const { supabase, calls } = fakeSupabase({
      vehicles: [{ data: [pendingRow("v1", "s1"), pendingRow("v2", "s1"), pendingRow("v3", "s2")], error: null }],
      profiles: [{ data: [{ id: "s1", username: "gozumkamil" }, { id: "s2", username: null }], error: null }],
    });
    const result = await fetchPendingListingRows(supabase);
    expect(result.ok && result.items.map((item) => item.sellerUsername)).toEqual(["gozumkamil", "gozumkamil", null]);
    expect(calls[1]).toEqual({ table: "profiles", steps: [["select", "id, username"], ["in", "id", ["s1", "s2"]]] });
  });

  it("satıcı adları okunamazsa kuyruk yine gelir, adlar boş", async () => {
    const { supabase } = fakeSupabase({
      vehicles: [{ data: [pendingRow("v1", "s1")], error: null }],
      profiles: [{ data: null, error: { message: "boom" } }],
    });
    const result = await fetchPendingListingRows(supabase);
    expect(result.ok && result.items[0].sellerUsername).toBeNull();
  });
});

describe("fetchAdminCounts (rozet)", () => {
  it("yalnızca sayım (head): kuyruk süzgeciyle ilanlar ve açık bildirimler", async () => {
    const { supabase, calls } = fakeSupabase({
      vehicles: [{ data: null, error: null, count: 3 }],
      reports: [{ data: null, error: null, count: 1 }],
    });
    expect(await fetchAdminCounts(supabase)).toEqual({ pendingListings: 3, openReports: 1 });
    expect(calls).toEqual([
      {
        table: "vehicles",
        steps: [
          ["select", "id", { count: "exact", head: true }],
          ["eq", "moderation_status", "pending"],
          ["or", PENDING_QUEUE_FILTER],
        ],
      },
      { table: "reports", steps: [["select", "id", { count: "exact", head: true }], ["eq", "status", "open"]] },
    ]);
  });

  it("okunamayan sayı null; diğeri etkilenmez", async () => {
    const { supabase } = fakeSupabase({
      vehicles: [{ data: null, error: { message: "boom" } }],
      reports: [{ data: null, error: null, count: 0 }],
    });
    expect(await fetchAdminCounts(supabase)).toEqual({ pendingListings: null, openReports: 0 });
  });
});

describe("fetchModerationQueueRows", () => {
  it("açık bildirimleri en eskiden yeniye okur ve ilan başına toplar", async () => {
    const { supabase, calls } = fakeSupabase({
      reports: [
        {
          data: [
            {
              id: "r1",
              reason: "spam",
              details: null,
              created_at: "2026-09-26T08:00:00Z",
              vehicle: {
                id: VEHICLE,
                status: "active",
                year: 2020,
                price: 1,
                currency: "TRY",
                mileage_km: 1,
                city: null,
                created_at: "2026-09-20T00:00:00Z",
                brand: { name: "Fiat" },
                model: { name: "Egea" },
                images: null,
                videos: null,
              },
            },
          ],
          error: null,
        },
      ],
    });

    const result = await fetchModerationQueueRows(supabase);
    expect(result.ok && result.items.map((i) => [i.vehicle.title, i.reports.length])).toEqual([["Fiat Egea", 1]]);
    const steps = calls[0].steps.map((s) => s.slice(0, 2));
    expect(steps).toContainEqual(["eq", "status"]);
    expect(calls[0].steps).toContainEqual(["order", "created_at", { ascending: true }]);
  });

  it("okuma hatası", async () => {
    const { supabase } = fakeSupabase({ reports: [{ data: null, error: { message: "boom" } }] });
    expect(await fetchModerationQueueRows(supabase)).toEqual({ ok: false });
  });
});
