import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Yorum şikayeti: nedenler (veritabanıyla eşitlik), istek doğrulaması, istemci
// çağrısı ve POST /api/reports'un yorum yolu. İlan bildirimi yolu değişmedi
// (lib/reports.test.ts, lib/reports-route.test.ts).

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabase: {} }));

const insert = vi.fn();
const commentLookup = vi.fn();
const rpc = vi.fn();
const getAuthenticatedUserId = vi.fn();
const selects: string[] = [];
vi.mock("./supabase-server", () => ({
  getAuthenticatedUserId: (request: Request) => getAuthenticatedUserId(request),
  getSupabaseAdmin: () => ({
    rpc,
    from: (table: string) =>
      table === "vehicle_comments"
        ? {
            select: (columns: string) => {
              selects.push(columns);
              return { eq: (_column: string, id: string) => ({ maybeSingle: () => commentLookup(id) }) };
            },
          }
        : { insert },
  }),
}));

import {
  COMMENT_REPORT_REASONS,
  REPORT_REASONS,
  isCommentReportBody,
  parseCommentReportInput,
  submitCommentReport,
} from "./reports";

const COMMENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VEHICLE = "11111111-1111-4111-8111-111111111111";
const AUTHOR = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";

describe("parseCommentReportInput", () => {
  it("geçerli isteği kabul eder, açıklamayı kırpar; boş açıklama null", () => {
    expect(parseCommentReportInput({ commentId: COMMENT, reason: "harassment", details: "  Hakaret ediyor " })).toEqual({
      ok: true,
      value: { commentId: COMMENT, reason: "harassment", details: "Hakaret ediyor" },
    });
    expect(parseCommentReportInput({ commentId: COMMENT, reason: "spam", details: "  " })).toMatchObject({
      ok: true,
      value: { details: null },
    });
  });

  it("geçersiz yorum kimliği", () => {
    for (const body of [{ commentId: "abc", reason: "spam" }, { reason: "spam" }, null]) {
      expect(parseCommentReportInput(body)).toMatchObject({ ok: false, code: "invalid_comment" });
    }
  });

  it("yalnızca yorum nedenleri: ilan nedenleri ve prototip adları geçmez", () => {
    for (const reason of ["sold", "wrong_info", "inappropriate", "toString", "__proto__", "", undefined]) {
      expect(parseCommentReportInput({ commentId: COMMENT, reason })).toMatchObject({ ok: false, code: "invalid_reason" });
    }
  });

  it("açıklama sınırı 500", () => {
    expect(parseCommentReportInput({ commentId: COMMENT, reason: "other", details: "a".repeat(500) }).ok).toBe(true);
    expect(parseCommentReportInput({ commentId: COMMENT, reason: "other", details: "a".repeat(501) })).toMatchObject({
      ok: false,
      code: "details_too_long",
    });
  });

  it("gövdede commentId varsa yorum şikayetidir", () => {
    expect(isCommentReportBody({ commentId: COMMENT })).toBe(true);
    expect(isCommentReportBody({ commentId: undefined })).toBe(true);
    expect(isCommentReportBody({ vehicleId: VEHICLE })).toBe(false);
    expect(isCommentReportBody(null)).toBe(false);
    expect(isCommentReportBody("commentId")).toBe(false);
  });
});

describe("nedenler veritabanındaki CHECK kısıtıyla aynı", () => {
  const sql = readFileSync("supabase/migrations/20260928180000_comment_reports.sql", "utf8");
  const listOf = (pattern: RegExp) => [...(sql.match(pattern)?.[1] ?? "").matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();

  it("yorum nedenleri", () => {
    expect(listOf(/comment_id is not null and reason in \(([^)]*)\)/)).toEqual(Object.keys(COMMENT_REPORT_REASONS).sort());
  });

  it("ilan nedenleri değişmedi", () => {
    expect(listOf(/comment_id is null and reason in \(([^)]*)\)/)).toEqual(Object.keys(REPORT_REASONS).sort());
  });
});

describe("submitCommentReport", () => {
  const input = { commentId: COMMENT, reason: "hate" as const, details: null };
  const respond = (status: number, body: unknown) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

  it("/api/reports'a yorum kimliğiyle gönderir; oturum varsa anahtarı ekler", async () => {
    const fetchImpl = respond(201, { ok: true });
    await expect(submitCommentReport(input, "tok", fetchImpl)).resolves.toEqual({ ok: true, already: false });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/reports");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init?.body as string)).toEqual(input);
  });

  it("misafir anonim gönderir; tekrar 'already'; hata mesajı iletilir", async () => {
    const anonymous = respond(201, { ok: true });
    await submitCommentReport(input, null, anonymous);
    expect(anonymous.mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");
    await expect(submitCommentReport(input, "t", respond(200, { ok: true, alreadyReported: true }))).resolves.toEqual({
      ok: true,
      already: true,
    });
    await expect(
      submitCommentReport(input, "t", respond(400, { error: { message: "Kendi yorumunu şikayet edemezsin." } })),
    ).resolves.toEqual({ ok: false, message: "Kendi yorumunu şikayet edemezsin." });
  });
});

describe("POST /api/reports (yorum şikayeti)", () => {
  type RouteModule = typeof import("../app/api/reports/route");
  let POST: RouteModule["POST"];

  const reportRequest = (body: unknown, ip = "203.0.113.9") =>
    new Request("https://gozuyle.com/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-real-ip": ip },
      body: JSON.stringify(body),
    });

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
    selects.length = 0;
    insert.mockReset().mockResolvedValue({ error: null });
    commentLookup.mockReset().mockResolvedValue({ data: { id: COMMENT, vehicle_id: VEHICLE, user_id: AUTHOR }, error: null });
    rpc.mockReset().mockResolvedValue({ data: 0, error: null });
    getAuthenticatedUserId.mockReset().mockResolvedValue(USER);
    ({ POST } = await import("../app/api/reports/route"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("kaydeder: ilan yorumdan okunur, istemcinin gönderdiği ilan kullanılmaz; istek sınırı ortak", async () => {
    const response = await POST(
      reportRequest({ commentId: COMMENT, vehicleId: "33333333-3333-4333-8333-333333333333", reason: "harassment", details: " Tehdit " }),
    );
    expect(response.status).toBe(201);
    expect(commentLookup).toHaveBeenCalledWith(COMMENT);
    expect(selects).toEqual(["id, vehicle_id, user_id"]);
    expect(insert).toHaveBeenCalledWith({
      vehicle_id: VEHICLE,
      comment_id: COMMENT,
      reporter_id: USER,
      reason: "harassment",
      details: "Tehdit",
    });
    expect(rpc).toHaveBeenCalledWith("fn_rate_limit_hit", expect.objectContaining({ p_keys: expect.any(Array) }));
    expect((rpc.mock.calls[0][1] as { p_keys: string[] }).p_keys[0]).toMatch(/^reports:user:/);
  });

  it("misafir de şikayet edebilir (anonim kurallar)", async () => {
    getAuthenticatedUserId.mockResolvedValue(null);
    expect((await POST(reportRequest({ commentId: COMMENT, reason: "spam" }))).status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ reporter_id: null }));
    expect((rpc.mock.calls[0][1] as { p_limits: number[] }).p_limits).toEqual([5, 20]);
  });

  it("olmayan ya da silinmiş yorum 404", async () => {
    commentLookup.mockResolvedValue({ data: null, error: null });
    const missing = await POST(reportRequest({ commentId: COMMENT, reason: "spam" }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "comment_not_found" } });
    expect(insert).not.toHaveBeenCalled();

    // Okunduktan sonra silindi (yabancı anahtar)
    commentLookup.mockResolvedValue({ data: { id: COMMENT, vehicle_id: VEHICLE, user_id: AUTHOR }, error: null });
    insert.mockResolvedValue({ error: { code: "23503" } });
    expect((await POST(reportRequest({ commentId: COMMENT, reason: "spam" }))).status).toBe(404);
  });

  it("kendi yorumunu şikayet edemez", async () => {
    getAuthenticatedUserId.mockResolvedValue(AUTHOR);
    const response = await POST(reportRequest({ commentId: COMMENT, reason: "spam" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "own_comment", message: "Kendi yorumunu şikayet edemezsin." } });
    expect(insert).not.toHaveBeenCalled();
  });

  it("aynı yorumu ikinci kez: 200 alreadyReported", async () => {
    insert.mockResolvedValue({ error: { code: "23505" } });
    const response = await POST(reportRequest({ commentId: COMMENT, reason: "spam" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, alreadyReported: true });
  });

  it("geçersiz neden ya da kimlik 400; yorum okunmaz", async () => {
    expect((await POST(reportRequest({ commentId: COMMENT, reason: "sold" }))).status).toBe(400);
    expect((await POST(reportRequest({ commentId: "x", reason: "spam" }))).status).toBe(400);
    expect(commentLookup).not.toHaveBeenCalled();
  });

  it("veritabanı hatası 500", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    commentLookup.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await POST(reportRequest({ commentId: COMMENT, reason: "spam" }))).status).toBe(500);
    commentLookup.mockResolvedValue({ data: { id: COMMENT, vehicle_id: VEHICLE, user_id: AUTHOR }, error: null });
    insert.mockResolvedValue({ error: { code: "XX000", message: "boom" } });
    expect((await POST(reportRequest({ commentId: COMMENT, reason: "spam" }))).status).toBe(500);
    consoleError.mockRestore();
  });

  it("ilan bildirimi yolu etkilenmez: commentId yoksa ilan doğrulaması", async () => {
    const response = await POST(reportRequest({ reason: "harassment" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_vehicle" } });
  });
});
