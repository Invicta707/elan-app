import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Yorum şikayetleri kuyruğu: gruplama, işlem doğrulaması, denetim kaydı
// karşılıkları, istemci çağrıları ve servis anahtarıyla yapılan sorgular.

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabase: {} }));
vi.mock("./supabase-server", () => ({
  getAuthenticatedUserId: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}));

import { removeReportedComment } from "./comments-server";
import {
  commentReportCategories,
  fetchCommentReports,
  parseCommentModerationAction,
  submitCommentModerationAction,
  toCommentReportQueue,
  type OpenCommentReportRow,
} from "./moderation";
import { COMMENT_REPORT_SELECT, fetchCommentReportRows, fetchModerationQueueRows } from "./moderation-server";

const COMMENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VEHICLE = "11111111-1111-4111-8111-111111111111";
const AUTHOR = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const REPORT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPORT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const vehicleRow = {
  id: VEHICLE,
  status: "active" as const,
  year: 2019,
  price: 1_250_000,
  currency: "TRY",
  mileage_km: 84_000,
  city: "İzmir",
  created_at: "2026-09-20T00:00:00Z",
  brand: { name: "Volkswagen" },
  model: { name: "Passat" },
  images: [{ image_url: "https://x/1.webp", is_primary: true, display_order: 0 }],
  videos: null,
};

const row = (id: string, commentId: string, overrides: Partial<OpenCommentReportRow> = {}): OpenCommentReportRow => ({
  id,
  reason: "harassment",
  details: null,
  created_at: "2026-09-28T10:00:00Z",
  comment: { id: commentId, content: `Yorum ${commentId}`, created_at: "2026-09-28T09:00:00Z", user_id: AUTHOR },
  vehicle: vehicleRow,
  ...overrides,
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("toCommentReportQueue", () => {
  it("yorum başına toplar (sıra korunur), yazarın herkese açık yüzünü ve ilanın özetini ekler", () => {
    const queue = toCommentReportQueue(
      [row(REPORT_A, COMMENT), row("r2", "other-comment", { reason: "spam" }), row(REPORT_B, COMMENT, { reason: "hate", details: "Irkçı" })],
      new Map([[AUTHOR, { id: AUTHOR, username: "alici", display_name: "Ali", avatar_url: null }]]),
    );
    expect(queue.map((item) => [item.comment.id, item.reports.map((r) => r.id)])).toEqual([
      [COMMENT, [REPORT_A, REPORT_B]],
      ["other-comment", ["r2"]],
    ]);
    expect(queue[0].comment).toMatchObject({ content: `Yorum ${COMMENT}`, authorUsername: "alici", authorDisplayName: "Ali" });
    expect(queue[0].vehicle).toEqual({ id: VEHICLE, title: "Volkswagen Passat", year: 2019, status: "active", coverUrl: "https://x/1.webp" });
    expect(queue[0].reports[1]).toEqual({ id: REPORT_B, reason: "hate", details: "Irkçı", createdAt: "2026-09-28T10:00:00Z" });
  });

  it("yorumu ya da ilanı okunamayan satır atlanır; yazar bilinmiyorsa adlar boş", () => {
    const queue = toCommentReportQueue([row("r1", COMMENT, { comment: null }), row("r2", "c2", { vehicle: null }), row("r3", "c3")]);
    expect(queue.map((item) => item.comment.id)).toEqual(["c3"]);
    expect(queue[0].comment.authorUsername).toBeNull();
  });
});

describe("parseCommentModerationAction", () => {
  it("yorumu silme", () => {
    expect(parseCommentModerationAction({ action: "delete_comment", commentId: COMMENT })).toEqual({
      ok: true,
      value: { action: "delete_comment", commentId: COMMENT },
    });
    expect(parseCommentModerationAction({ action: "delete_comment", commentId: "x" })).toMatchObject({ ok: false, code: "invalid_comment" });
  });

  it("şikayetleri yoksayma: tekrarlar tekilleşir; boş, çok uzun ya da bozuk liste reddedilir", () => {
    expect(parseCommentModerationAction({ action: "dismiss", reportIds: [REPORT_A, REPORT_A, REPORT_B] })).toEqual({
      ok: true,
      value: { action: "dismiss", reportIds: [REPORT_A, REPORT_B] },
    });
    for (const reportIds of [[], ["x"], Array.from({ length: 101 }, () => REPORT_A), undefined]) {
      expect(parseCommentModerationAction({ action: "dismiss", reportIds })).toMatchObject({ ok: false, code: "invalid_reports" });
    }
  });

  it("ilan işlemleri burada geçmez", () => {
    for (const action of ["remove_listing", "approve", undefined]) {
      expect(parseCommentModerationAction({ action, commentId: COMMENT })).toMatchObject({ ok: false, code: "invalid_action" });
    }
  });
});

describe("commentReportCategories (denetim kaydı)", () => {
  it("taciz, nefret ve cinsel içerik karşılıklarını bir kez verir; diğerleri boş", () => {
    expect(commentReportCategories(["harassment", "spam", "harassment", "sexual", "hate", "fraud", "other"])).toEqual([
      "harassment",
      "sexual",
      "hate",
    ]);
    expect(commentReportCategories(["spam", "other"])).toEqual([]);
  });
});

describe("istemci çağrıları (/api/admin/comment-reports)", () => {
  const respond = (status: number, body: unknown) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

  it("kuyruk: GET, oturum anahtarıyla, önbelleksiz", async () => {
    const fetchImpl = respond(200, { items: [] });
    expect(await fetchCommentReports("tok", fetchImpl)).toEqual({ ok: true, items: [] });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/admin/comment-reports");
    expect(init).toMatchObject({ method: "GET", cache: "no-store", headers: { Authorization: "Bearer tok" } });
  });

  it("işlem: POST gövdesi; yetki hatası durum koduyla döner", async () => {
    const fetchImpl = respond(200, { ok: true, resolved: 2 });
    expect(await submitCommentModerationAction({ action: "delete_comment", commentId: COMMENT }, "tok", fetchImpl)).toEqual({
      ok: true,
      resolved: 2,
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string)).toEqual({ action: "delete_comment", commentId: COMMENT });
    expect(await fetchCommentReports("tok", respond(403, { error: { message: "Bu sayfaya erişim yetkin yok." } }))).toEqual({
      ok: false,
      status: 403,
      message: "Bu sayfaya erişim yetkin yok.",
    });
  });
});

// PostgREST sorgu zincirinin taklidi (lib/moderation-server.test.ts ile aynı):
// her tablo çağrısındaki adımlar kaydedilir, sonuç tablo başına sırayla verilir.
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

describe("fetchCommentReportRows", () => {
  it("açık yorum şikayetleri, en eskisi önce; ilişkiler yabancı anahtar adıyla; yazarlar tek sorguda", async () => {
    const { supabase, calls } = fakeSupabase({
      reports: [{ data: [row(REPORT_A, COMMENT), row(REPORT_B, COMMENT)], error: null }],
      profiles: [{ data: [{ id: AUTHOR, username: "alici", display_name: null, avatar_url: null }], error: null }],
    });
    const result = await fetchCommentReportRows(supabase);
    expect(result.ok && result.items.map((item) => [item.comment.authorUsername, item.reports.length])).toEqual([["alici", 2]]);
    expect(calls[0]).toEqual({
      table: "reports",
      steps: [
        ["select", COMMENT_REPORT_SELECT],
        ["eq", "status", "open"],
        ["not", "comment_id", "is", null],
        ["order", "created_at", { ascending: true }],
        ["limit", 500],
      ],
    });
    expect(COMMENT_REPORT_SELECT).toContain("vehicle_comments!reports_comment_id_fkey(");
    expect(COMMENT_REPORT_SELECT).toContain("vehicles!reports_vehicle_id_fkey(");
    expect(calls[1]).toEqual({ table: "profiles", steps: [["select", "id, username, display_name, avatar_url"], ["in", "id", [AUTHOR]]] });
  });

  it("okunamazsa ok: false; yazarlar okunamazsa kuyruk yine gelir", async () => {
    expect(await fetchCommentReportRows(fakeSupabase({ reports: [{ data: null, error: { message: "boom" } }] }).supabase)).toEqual({
      ok: false,
    });
    const { supabase } = fakeSupabase({
      reports: [{ data: [row(REPORT_A, COMMENT)], error: null }],
      profiles: [{ data: null, error: { message: "boom" } }],
    });
    const result = await fetchCommentReportRows(supabase);
    expect(result.ok && result.items[0].comment.authorUsername).toBeNull();
  });

  it("ilan bildirimleri kuyruğu yorum şikayetlerini almaz", async () => {
    const { supabase, calls } = fakeSupabase({ reports: [{ data: [], error: null }] });
    await fetchModerationQueueRows(supabase);
    expect(calls[0].steps).toContainEqual(["is", "comment_id", null]);
  });
});

describe("removeReportedComment", () => {
  it("yorumu siler (şikayetleri CASCADE ile gider), kararı şikayet nedenleriyle kayda yazar", async () => {
    const { supabase, calls } = fakeSupabase({
      vehicle_comments: [
        { data: { id: COMMENT, user_id: AUTHOR }, error: null },
        { data: [{ id: COMMENT }], error: null },
      ],
      reports: [{ data: [{ reason: "harassment" }, { reason: "spam" }], error: null }],
      content_moderation_events: [{ data: null, error: null }],
    });
    expect(await removeReportedComment(supabase, COMMENT, ADMIN_ID)).toEqual({ ok: true, resolved: 2 });
    expect(calls.map((call) => call.table)).toEqual(["vehicle_comments", "reports", "vehicle_comments", "content_moderation_events"]);
    expect(calls[2].steps).toEqual([["delete"], ["eq", "id", COMMENT], ["select", "id"]]);
    expect(calls[3].steps[0]).toEqual([
      "insert",
      {
        subject_type: "comment",
        subject_id: COMMENT,
        user_id: AUTHOR,
        moderator_id: ADMIN_ID,
        provider: "manual",
        decision: "rejected",
        reasons: ["harassment"],
        scores: {},
      },
    ]);
  });

  it("yorum yoksa ya da bu arada silindiyse comment_not_found; kayıt yazılmaz", async () => {
    const missing = fakeSupabase({ vehicle_comments: [{ data: null, error: null }] });
    expect(await removeReportedComment(missing.supabase, COMMENT, ADMIN_ID)).toEqual({ ok: false, code: "comment_not_found" });
    expect(missing.calls.map((call) => call.table)).toEqual(["vehicle_comments"]);

    const raced = fakeSupabase({
      vehicle_comments: [
        { data: { id: COMMENT, user_id: AUTHOR }, error: null },
        { data: [], error: null },
      ],
      reports: [{ data: [], error: null }],
    });
    expect(await removeReportedComment(raced.supabase, COMMENT, ADMIN_ID)).toEqual({ ok: false, code: "comment_not_found" });
    expect(raced.calls.map((call) => call.table)).not.toContain("content_moderation_events");
  });

  it("silme hatası database_error", async () => {
    const { supabase } = fakeSupabase({
      vehicle_comments: [
        { data: { id: COMMENT, user_id: AUTHOR }, error: null },
        { data: null, error: { message: "boom" } },
      ],
      reports: [{ data: [], error: null }],
    });
    expect(await removeReportedComment(supabase, COMMENT, ADMIN_ID)).toEqual({ ok: false, code: "database_error" });
  });
});
