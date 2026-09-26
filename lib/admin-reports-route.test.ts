import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/admin/reports (app/api/admin/reports/route.ts): yetki, doğrulama ve
// işlemlerin doğru fonksiyonlara yönlendirilmesi. İşlemlerin kendisi
// lib/moderation-server.test.ts'te.

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabase: {} }));

const adminClient = { marker: "admin-client" };
vi.mock("./supabase-server", () => ({ getSupabaseAdmin: () => adminClient }));
vi.mock("./moderation-server", () => ({
  authorizeAdmin: vi.fn(),
  fetchModerationQueueRows: vi.fn(),
  removeListing: vi.fn(),
  dismissReports: vi.fn(),
}));

import { GET, POST } from "../app/api/admin/reports/route";
import { authorizeAdmin, dismissReports, fetchModerationQueueRows, removeListing } from "./moderation-server";

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const VEHICLE = "11111111-1111-4111-8111-111111111111";
const REPORT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function get() {
  return GET(new Request("https://gozuyle.com/api/admin/reports", { headers: { Authorization: "Bearer tok" } }));
}

function post(body: unknown) {
  return POST(
    new Request("https://gozuyle.com/api/admin/reports", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.mocked(authorizeAdmin).mockReset().mockResolvedValue({ ok: true, userId: ADMIN_ID });
  vi.mocked(fetchModerationQueueRows).mockReset().mockResolvedValue({ ok: true, items: [] });
  vi.mocked(removeListing).mockReset().mockResolvedValue({ ok: true, resolved: 2 });
  vi.mocked(dismissReports).mockReset().mockResolvedValue({ ok: true, resolved: 1 });
});

describe("yetki", () => {
  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
  ] as const)("yönetici değilse %s: veri okunmaz, işlem yapılmaz", async (status, code) => {
    vi.mocked(authorizeAdmin).mockResolvedValue({ ok: false, status });

    for (const response of [await get(), await post({ action: "remove_listing", vehicleId: VEHICLE })]) {
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    expect(fetchModerationQueueRows).not.toHaveBeenCalled();
    expect(removeListing).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("yöneticiye kuyruğu önbelleksiz döner", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [] });
    expect(fetchModerationQueueRows).toHaveBeenCalledWith(adminClient);
  });

  it("okuma hatası 500", async () => {
    vi.mocked(fetchModerationQueueRows).mockResolvedValue({ ok: false });
    expect((await get()).status).toBe(500);
  });
});

describe("POST", () => {
  it("ilanı kaldırır; işlemi yapan yönetici kaydedilir", async () => {
    const response = await post({ action: "remove_listing", vehicleId: VEHICLE });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, resolved: 2 });
    expect(removeListing).toHaveBeenCalledWith(adminClient, VEHICLE, ADMIN_ID);
    expect(dismissReports).not.toHaveBeenCalled();
  });

  it("bildirimi kapatır; ilana dokunmaz", async () => {
    const response = await post({ action: "dismiss", reportIds: [REPORT] });
    expect(await response.json()).toEqual({ ok: true, resolved: 1 });
    expect(dismissReports).toHaveBeenCalledWith(adminClient, [REPORT], ADMIN_ID);
    expect(removeListing).not.toHaveBeenCalled();
  });

  it("geçersiz gövde 400", async () => {
    for (const body of ["{bozuk", { action: "remove_listing", vehicleId: "abc" }, { action: "sil" }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(removeListing).not.toHaveBeenCalled();
  });

  it("olmayan ilan 404, veritabanı hatası 500", async () => {
    vi.mocked(removeListing).mockResolvedValueOnce({ ok: false, code: "vehicle_not_found" });
    expect((await post({ action: "remove_listing", vehicleId: VEHICLE })).status).toBe(404);

    vi.mocked(dismissReports).mockResolvedValueOnce({ ok: false, code: "database_error" });
    expect((await post({ action: "dismiss", reportIds: [REPORT] })).status).toBe(500);
  });
});
