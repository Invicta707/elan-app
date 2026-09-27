import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/messages (app/api/messages/route.ts): içerik denetimi ve kullanıcının
// kendi oturumuyla yazım. Bellek içi sınırın durumu modül düzeyinde tutulduğu
// için her testte route yeniden yüklenir.

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabase: {} }));

const getAuthenticatedUserId = vi.fn();
const single = vi.fn();
const insert = vi.fn(() => ({ select: () => ({ single }) }));
const getSupabaseForUser = vi.fn((token: string) => ({ token, from: () => ({ insert }) }));
const eventInsert = vi.fn();
vi.mock("./supabase-server", () => ({
  bearerToken: (request: Request) => request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null,
  getAuthenticatedUserId: (request: Request) => getAuthenticatedUserId(request),
  getSupabaseForUser: (token: string) => getSupabaseForUser(token),
  getSupabaseAdmin: () => ({ from: () => ({ insert: eventInsert }) }),
}));

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const USER = "99999999-9999-4999-8999-999999999999";
const ROW = { id: "m1", conversation_id: CONVERSATION, sender_id: USER, text: "Merhaba", is_read: false, created_at: "2026-09-28T10:00:00Z" };

type RouteModule = typeof import("../app/api/messages/route");
let POST: RouteModule["POST"];

function send(body: unknown, token: string | null = "tok") {
  return new Request("https://gozuyle.com/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

const openAi = (scores: Record<string, number>) =>
  vi.fn(async () =>
    new Response(JSON.stringify({ results: [{ category_scores: scores }] }), {
      headers: { "Content-Type": "application/json" },
    }),
  );

beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getAuthenticatedUserId.mockReset().mockResolvedValue(USER);
  single.mockReset().mockResolvedValue({ data: ROW, error: null });
  insert.mockClear();
  getSupabaseForUser.mockClear();
  eventInsert.mockReset().mockResolvedValue({ error: null });
  ({ POST } = await import("../app/api/messages/route"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/messages", () => {
  it("temiz mesajı kullanıcının kendi oturumuyla yazar", async () => {
    const response = await POST(send({ conversationId: CONVERSATION, text: "  Merhaba  " }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ message: ROW });
    expect(getSupabaseForUser).toHaveBeenCalledWith("tok");
    expect(insert).toHaveBeenCalledWith({ conversation_id: CONVERSATION, sender_id: USER, text: "Merhaba" });
    expect(eventInsert).not.toHaveBeenCalled();
  });

  it("oturum yoksa 401, veritabanına gidilmez", async () => {
    expect((await POST(send({ conversationId: CONVERSATION, text: "x" }, null))).status).toBe(401);
    getAuthenticatedUserId.mockResolvedValue(null);
    expect((await POST(send({ conversationId: CONVERSATION, text: "x" }))).status).toBe(401);
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    [{ conversationId: "x", text: "a" }],
    [{ conversationId: CONVERSATION, text: "   " }],
    [{ conversationId: CONVERSATION, text: "a".repeat(2001) }],
    [{ conversationId: CONVERSATION }],
  ])("geçersiz istek 400: %j", async (body) => {
    expect((await POST(send(body))).status).toBe(400);
  });

  it("temel filtreye takılan mesaj yazılmaz, karar kaydedilir (metin kaydedilmez)", async () => {
    const response = await POST(send({ conversationId: CONVERSATION, text: "s1kt1r git" }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("content_policy");
    expect(insert).not.toHaveBeenCalled();
    expect(eventInsert).toHaveBeenCalledWith(
      expect.objectContaining({ subject_type: "message", subject_id: CONVERSATION, user_id: USER, decision: "rejected", reasons: ["profanity"] }),
    );
    expect(JSON.stringify(eventInsert.mock.calls)).not.toContain("git");
  });

  it("OpenAI tanımlıysa tacizi yakalar", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", openAi({ harassment: 0.1, "harassment/threatening": 0.93 }));
    const response = await POST(send({ conversationId: CONVERSATION, text: "Seni bir bulursam görürsün" }));
    expect(response.status).toBe(422);
    expect(insert).not.toHaveBeenCalled();
    expect(eventInsert).toHaveBeenCalledWith(expect.objectContaining({ provider: "local+openai", reasons: ["harassment"] }));
  });

  it("OpenAI'ye ulaşılamazsa mesaj yine gider (taban kural veritabanında)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    expect((await POST(send({ conversationId: CONVERSATION, text: "Merhaba" }))).status).toBe(201);
  });

  it.each([
    [{ code: "42501", message: "rls" }, 403, "Bu sohbete mesaj gönderilemiyor."],
    [{ code: "23514", message: "Çok hızlı mesaj gönderiyorsun; biraz bekleyip tekrar dene." }, 422, "Çok hızlı mesaj gönderiyorsun; biraz bekleyip tekrar dene."],
    [{ code: "XX000", message: "boom" }, 500, "Mesaj gönderilemedi."],
  ])("veritabanı reddi %j → %i", async (error, status, message) => {
    single.mockResolvedValue({ data: null, error });
    const response = await POST(send({ conversationId: CONVERSATION, text: "Merhaba" }));
    expect(response.status).toBe(status);
    expect((await response.json()).error.message).toBe(message);
  });

  it("kullanıcı başına ani seri sınırlanır", async () => {
    for (let i = 0; i < 60; i += 1) await POST(send({ conversationId: CONVERSATION, text: "Merhaba" }));
    const response = await POST(send({ conversationId: CONVERSATION, text: "Merhaba" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toMatch(/^\d+$/);
  });
});
