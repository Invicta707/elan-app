import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/admin/status (app/api/admin/status/route.ts): Vitrinim ve Ayarlar'daki
// "İlan Onay Paneli" girişi. Yönetici denetimi lib/moderation-server.test.ts'te.

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabase: {} }));

const adminClient = { marker: "admin-client" };
vi.mock("./supabase-server", () => ({ getSupabaseAdmin: () => adminClient }));
vi.mock("./moderation-server", () => ({ checkAdminStatus: vi.fn(), fetchAdminCounts: vi.fn() }));

import { GET } from "../app/api/admin/status/route";
import { checkAdminStatus, fetchAdminCounts } from "./moderation-server";

const get = () => GET(new Request("https://gozuyle.com/api/admin/status", { headers: { Authorization: "Bearer tok" } }));

beforeEach(() => {
  vi.mocked(checkAdminStatus).mockReset();
  vi.mocked(fetchAdminCounts).mockReset().mockResolvedValue({ pendingListings: 2, openReports: 1 });
});

describe("GET /api/admin/status", () => {
  it("oturum yoksa 401", async () => {
    vi.mocked(checkAdminStatus).mockResolvedValue({ status: 401 });
    const response = await get();
    expect(response.status).toBe(401);
    expect(fetchAdminCounts).not.toHaveBeenCalled();
  });

  it("yönetici değilse yalnızca admin: false; sayı okunmaz, yönetici listesi dönmez", async () => {
    vi.mocked(checkAdminStatus).mockResolvedValue({ status: 200, admin: false });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ admin: false });
    expect(fetchAdminCounts).not.toHaveBeenCalled();
  });

  it("yöneticiye bekleyen iş sayıları", async () => {
    vi.mocked(checkAdminStatus).mockResolvedValue({ status: 200, admin: true, userId: "a1" });
    const response = await get();
    expect(await response.json()).toEqual({ admin: true, pendingListings: 2, openReports: 1 });
    expect(fetchAdminCounts).toHaveBeenCalledWith(adminClient);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
