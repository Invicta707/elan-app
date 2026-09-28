import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/admin/comment-reports: yetki, doğrulama ve işlemlerin doğru fonksiyonlara
// yönlendirilmesi. İşlemlerin kendisi lib/comment-moderation.test.ts'te.

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabase: {} }));

const adminClient = { marker: "admin-client" };
vi.mock("./supabase-server", () => ({ getSupabaseAdmin: () => adminClient }));
vi.mock("./moderation-server", () => ({
  authorizeAdmin: vi.fn(),
  fetchCommentReportRows: vi.fn(),
  dismissReports: vi.fn(),
}));
vi.mock("./comments-server", () => ({ removeReportedComment: vi.fn() }));

import { GET, POST } from "../app/api/admin/comment-reports/route";
import { removeReportedComment } from "./comments-server";
import { authorizeAdmin, dismissReports, fetchCommentReportRows } from "./moderation-server";

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const COMMENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REPORT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const get = () => GET(new Request("https://gozuyle.com/api/admin/comment-reports", { headers: { Authorization: "Bearer tok" } }));
const post = (body: unknown) =>
  POST(
    new Request("https://gozuyle.com/api/admin/comment-reports", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.mocked(authorizeAdmin).mockReset().mockResolvedValue({ ok: true, userId: ADMIN_ID });
  vi.mocked(fetchCommentReportRows).mockReset().mockResolvedValue({ ok: true, items: [] });
  vi.mocked(removeReportedComment).mockReset().mockResolvedValue({ ok: true, resolved: 2 });
  vi.mocked(dismissReports).mockReset().mockResolvedValue({ ok: true, resolved: 1 });
});

describe("yetki", () => {
  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
  ] as const)("yönetici değilse %s: veri okunmaz, işlem yapılmaz", async (status, code) => {
    vi.mocked(authorizeAdmin).mockResolvedValue({ ok: false, status });
    for (const response of [await get(), await post({ action: "delete_comment", commentId: COMMENT })]) {
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    expect(fetchCommentReportRows).not.toHaveBeenCalled();
    expect(removeReportedComment).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("kuyruğu servis anahtarıyla okur; önbelleğe alınmaz", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [] });
    expect(fetchCommentReportRows).toHaveBeenCalledWith(adminClient);
  });

  it("okuma hatası 500", async () => {
    vi.mocked(fetchCommentReportRows).mockResolvedValue({ ok: false });
    expect((await get()).status).toBe(500);
  });
});

describe("POST", () => {
  it("yorumu sil: yönetici kimliğiyle", async () => {
    const response = await post({ action: "delete_comment", commentId: COMMENT });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, resolved: 2 });
    expect(removeReportedComment).toHaveBeenCalledWith(adminClient, COMMENT, ADMIN_ID);
  });

  it("yoksay: yalnızca verilen şikayetler", async () => {
    expect((await post({ action: "dismiss", reportIds: [REPORT] })).status).toBe(200);
    expect(dismissReports).toHaveBeenCalledWith(adminClient, [REPORT], ADMIN_ID);
    expect(removeReportedComment).not.toHaveBeenCalled();
  });

  it("geçersiz gövde 400; işlem yapılmaz", async () => {
    for (const body of ["{bozuk", { action: "remove_listing", vehicleId: COMMENT }, { action: "delete_comment" }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(removeReportedComment).not.toHaveBeenCalled();
    expect(dismissReports).not.toHaveBeenCalled();
  });

  it("yorum yoksa 404, veritabanı hatası 500", async () => {
    vi.mocked(removeReportedComment).mockResolvedValueOnce({ ok: false, code: "comment_not_found" });
    const missing = await post({ action: "delete_comment", commentId: COMMENT });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "comment_not_found" } });
    vi.mocked(removeReportedComment).mockResolvedValueOnce({ ok: false, code: "database_error" });
    expect((await post({ action: "delete_comment", commentId: COMMENT })).status).toBe(500);
  });
});
