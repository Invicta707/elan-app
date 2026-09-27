import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/admin/listings (app/api/admin/listings/route.ts): yetki, karar ve
// hataların HTTP yanıtlarına çevrilmesi. Karar mantığı lib/listing-moderation.test.ts'te.

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabase: {} }));

const adminClient = { marker: "admin-client" };
vi.mock("./supabase-server", () => ({ getSupabaseAdmin: () => adminClient }));
vi.mock("./moderation-server", () => ({ authorizeAdmin: vi.fn(), fetchPendingListingRows: vi.fn() }));
vi.mock("./cloudflare", () => ({ streamVideoAvailable: vi.fn(), deleteStreamVideo: vi.fn() }));
vi.mock("./listing-moderation", () => ({
  createListingModerationStore: vi.fn(() => ({ marker: "store" })),
  decideListingManually: vi.fn(),
  moderateListing: vi.fn(),
}));

import { GET, POST } from "../app/api/admin/listings/route";
import { streamVideoAvailable } from "./cloudflare";
import { decideListingManually, moderateListing } from "./listing-moderation";
import { authorizeAdmin, fetchPendingListingRows } from "./moderation-server";

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const VEHICLE = "11111111-1111-4111-8111-111111111111";

const post = (body: unknown) =>
  POST(
    new Request("https://gozuyle.com/api/admin/listings", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(authorizeAdmin).mockReset().mockResolvedValue({ ok: true, userId: ADMIN_ID });
  vi.mocked(fetchPendingListingRows).mockReset().mockResolvedValue({ ok: true, items: [] });
  vi.mocked(decideListingManually).mockReset().mockResolvedValue({ ok: true, published: true });
  vi.mocked(moderateListing).mockReset();
});

describe("/api/admin/listings", () => {
  it("yönetici değilse 403, oturum yoksa 401; karar verilmez", async () => {
    vi.mocked(authorizeAdmin).mockResolvedValueOnce({ ok: false, status: 403 });
    expect((await post({ action: "approve", vehicleId: VEHICLE })).status).toBe(403);
    vi.mocked(authorizeAdmin).mockResolvedValueOnce({ ok: false, status: 401 });
    expect((await GET(new Request("https://gozuyle.com/api/admin/listings"))).status).toBe(401);
    expect(decideListingManually).not.toHaveBeenCalled();
  });

  it("onay: Cloudflare'de video var mı diye sorulur; yayına alınır", async () => {
    const response = await post({ action: "approve", vehicleId: VEHICLE });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, decision: "safe", published: true });
    expect(decideListingManually).toHaveBeenCalledWith({ marker: "store" }, VEHICLE, "approve", ADMIN_ID, {
      videoAvailable: streamVideoAvailable,
    });
  });

  it("videosu silinmiş ilan: 409 video_missing ve açıklayıcı mesaj", async () => {
    vi.mocked(decideListingManually).mockResolvedValue({ ok: false, code: "video_missing" });
    const response = await post({ action: "approve", vehicleId: VEHICLE });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "video_missing",
        message: "Bu ilanın videosu Cloudflare'de bulunamadı (silinmiş). Yayına alınamaz; ilanı reddedebilirsin.",
      },
    });
  });

  it("karar verilmiş 409, olmayan ilan 404", async () => {
    vi.mocked(decideListingManually).mockResolvedValueOnce({ ok: false, code: "already_decided" });
    expect(await (await post({ action: "reject", vehicleId: VEHICLE })).json()).toMatchObject({ error: { code: "already_decided" } });
    vi.mocked(decideListingManually).mockResolvedValueOnce({ ok: false, code: "vehicle_not_found" });
    expect((await post({ action: "reject", vehicleId: VEHICLE })).status).toBe(404);
  });

  it("tekrar denetle: otomatik denetim yayına almaz", async () => {
    vi.mocked(moderateListing).mockResolvedValue({ status: "decided", decision: "safe", reasons: [], published: false });
    expect(await (await post({ action: "recheck", vehicleId: VEHICLE })).json()).toEqual({
      ok: true,
      decision: "safe",
      published: false,
    });
    expect(decideListingManually).not.toHaveBeenCalled();
  });
});
