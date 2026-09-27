import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/vehicles/[id]/comments ve .../[commentId]: kimlik, istemci seçimi,
// yönetici hakkı ve yanıtlar. İşlemlerin kendisi lib/comments-server.test.ts'te.

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabase: {} }));

const userClient = { marker: "user" };
const publicClient = { marker: "public" };
const adminClient = { marker: "admin" };
vi.mock("./supabase-server", () => ({
  bearerToken: (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null,
  getAuthenticatedUserId: vi.fn(),
  getSupabaseForUser: vi.fn(() => userClient),
  getSupabasePublic: vi.fn(() => publicClient),
  getSupabaseAdmin: vi.fn(() => adminClient),
}));
vi.mock("./moderation-server", () => ({ checkAdminStatus: vi.fn(), authorizeAdmin: vi.fn() }));
vi.mock("./moderation-providers", () => ({ moderationProvidersFromEnv: () => ({ image: null, text: null }) }));
vi.mock("./comments-server", () => ({
  listVehicleComments: vi.fn(),
  createVehicleComment: vi.fn(),
  deleteVehicleComment: vi.fn(),
}));

import { GET, POST } from "../app/api/vehicles/[id]/comments/route";
import { DELETE } from "../app/api/vehicles/[id]/comments/[commentId]/route";
import { createVehicleComment, deleteVehicleComment, listVehicleComments } from "./comments-server";
import { authorizeAdmin, checkAdminStatus } from "./moderation-server";
import { getAuthenticatedUserId } from "./supabase-server";

const VEHICLE = "11111111-1111-4111-8111-111111111111";
const COMMENT = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const ctx = { params: Promise.resolve({ id: VEHICLE }) };
const page = { total: 0, comments: [], nextCursor: null };

const request = (path: string, init: RequestInit & { token?: string } = {}) =>
  new Request(`https://gozuyle.com${path}`, {
    ...init,
    headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });

beforeEach(() => {
  vi.mocked(getAuthenticatedUserId).mockReset().mockResolvedValue(USER);
  vi.mocked(checkAdminStatus).mockReset().mockResolvedValue({ status: 200, admin: false });
  vi.mocked(authorizeAdmin).mockReset().mockResolvedValue({ ok: false, status: 403 });
  vi.mocked(listVehicleComments).mockReset().mockResolvedValue({ ok: true, page });
  vi.mocked(createVehicleComment).mockReset();
  vi.mocked(deleteVehicleComment).mockReset().mockResolvedValue({ ok: true });
});

describe("GET yorumlar", () => {
  it("misafir: yayımlanabilir anahtarla (RLS), önbelleksiz", async () => {
    const response = await GET(request(`/api/vehicles/${VEHICLE}/comments?limit=10`), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(page);
    expect(listVehicleComments).toHaveBeenCalledWith(publicClient, VEHICLE, { cursor: null, limit: 10, viewerIsAdmin: false });
  });

  it("oturum: kendi yetkisiyle; yönetici her yorumu silebilir", async () => {
    vi.mocked(checkAdminStatus).mockResolvedValue({ status: 200, admin: true, userId: USER });
    await GET(request(`/api/vehicles/${VEHICLE}/comments`, { token: "tok" }), ctx);
    expect(listVehicleComments).toHaveBeenCalledWith(userClient, VEHICLE, { cursor: null, limit: 20, viewerIsAdmin: true });
  });

  it("geçersiz token misafir sayılır; bozuk imleç 400; bozuk ilan kimliği 404", async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(null);
    await GET(request(`/api/vehicles/${VEHICLE}/comments`, { token: "bozuk" }), ctx);
    expect(vi.mocked(listVehicleComments).mock.calls[0][0]).toBe(publicClient);
    expect((await GET(request(`/api/vehicles/${VEHICLE}/comments?before=dun`), ctx)).status).toBe(400);
    expect((await GET(request("/api/vehicles/x/comments"), { params: Promise.resolve({ id: "x" }) })).status).toBe(404);
  });

  it("imleç sunucu işlevine geçer; hata durum koduyla döner", async () => {
    const before = "2026-09-28T10:00:00.1+00:00";
    vi.mocked(listVehicleComments).mockResolvedValueOnce({ ok: false, status: 404, code: "vehicle_not_found", message: "yok" });
    const response = await GET(request(`/api/vehicles/${VEHICLE}/comments?before=${encodeURIComponent(before)}&beforeId=${COMMENT}`), ctx);
    expect(response.status).toBe(404);
    expect(vi.mocked(listVehicleComments).mock.calls[0][2]).toMatchObject({ cursor: { before, beforeId: COMMENT } });
  });
});

describe("POST yorum", () => {
  it("oturum yoksa 401; sunucu işlevi çağrılmaz", async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(null);
    const response = await POST(request(`/api/vehicles/${VEHICLE}/comments`, { method: "POST", body: "{}" }), ctx);
    expect(response.status).toBe(401);
    expect(createVehicleComment).not.toHaveBeenCalled();
  });

  it("kullanıcının oturumuyla yazar; 201", async () => {
    const comment = { id: COMMENT };
    vi.mocked(createVehicleComment).mockResolvedValue({ ok: true, comment: comment as never });
    const response = await POST(
      request(`/api/vehicles/${VEHICLE}/comments`, { method: "POST", body: JSON.stringify({ content: "Merhaba" }), token: "tok" }),
      ctx,
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ comment });
    expect(createVehicleComment).toHaveBeenCalledWith(
      expect.objectContaining({ userClient, adminClient, userId: USER, vehicleId: VEHICLE, content: "Merhaba", textModerator: null }),
    );
  });

  it("spam sınırı 429 + Retry-After; diğer hatalar koduyla", async () => {
    vi.mocked(createVehicleComment).mockResolvedValueOnce({ ok: false, status: 429, code: "rate_limited", message: "Bekle." });
    const limited = await POST(request(`/api/vehicles/${VEHICLE}/comments`, { method: "POST", body: "{}", token: "tok" }), ctx);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("10");
    vi.mocked(createVehicleComment).mockResolvedValueOnce({ ok: false, status: 409, code: "username_required", message: "Ad seç." });
    const response = await POST(request(`/api/vehicles/${VEHICLE}/comments`, { method: "POST", body: "{}", token: "tok" }), ctx);
    expect(await response.json()).toEqual({ error: { code: "username_required", message: "Ad seç." } });
  });
});

describe("DELETE yorum", () => {
  const dctx = { params: Promise.resolve({ id: VEHICLE, commentId: COMMENT }) };

  it("oturum yoksa 401; bozuk kimlik 404", async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(null);
    expect((await DELETE(request(`/api/vehicles/${VEHICLE}/comments/${COMMENT}`, { method: "DELETE" }), dctx)).status).toBe(401);
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(USER);
    const bad = { params: Promise.resolve({ id: VEHICLE, commentId: "x" }) };
    expect((await DELETE(request(`/api/vehicles/${VEHICLE}/comments/x`, { method: "DELETE", token: "tok" }), bad)).status).toBe(404);
  });

  it("silme işlevine kullanıcı ve yönetici istemcisi; yönetici sorusu ADMIN_EMAILS'e", async () => {
    const response = await DELETE(request(`/api/vehicles/${VEHICLE}/comments/${COMMENT}`, { method: "DELETE", token: "tok" }), dctx);
    expect(response.status).toBe(200);
    const args = vi.mocked(deleteVehicleComment).mock.calls[0][0];
    expect(args).toMatchObject({ userClient, adminClient, userId: USER, vehicleId: VEHICLE, commentId: COMMENT });
    expect(await args.isAdmin()).toBe(false);
    vi.mocked(authorizeAdmin).mockResolvedValue({ ok: true, userId: USER });
    expect(await args.isAdmin()).toBe(true);
  });

  it("yetkisiz 403 koduyla", async () => {
    vi.mocked(deleteVehicleComment).mockResolvedValue({ ok: false, status: 403, code: "forbidden", message: "Yetkin yok." });
    const response = await DELETE(request(`/api/vehicles/${VEHICLE}/comments/${COMMENT}`, { method: "DELETE", token: "tok" }), dctx);
    expect(response.status).toBe(403);
  });
});
