import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/reports (app/api/reports/route.ts): iki katmanlı istek sınırı ve temel akış.
// Bellek içi ön sınırın durumu modül düzeyinde tutulduğu için her testte route
// yeniden yüklenir. Kalıcı sayacın kendisi lib/rate-limit-db.test.ts'te (PGlite).

vi.mock("server-only", () => ({}));

const insert = vi.fn();
const maybeSingle = vi.fn();
const rpc = vi.fn();
const getAuthenticatedUserId = vi.fn();
vi.mock("./supabase-server", () => ({
  getAuthenticatedUserId: (request: Request) => getAuthenticatedUserId(request),
  getSupabaseAdmin: () => ({
    rpc,
    from: (table: string) =>
      table === "vehicles" ? { select: () => ({ eq: () => ({ maybeSingle }) }) } : { insert },
  }),
}));

const VEHICLE = "11111111-1111-4111-8111-111111111111";
const USER = "99999999-9999-4999-8999-999999999999";

type RouteModule = typeof import("../app/api/reports/route");
let POST: RouteModule["POST"];

function reportRequest(ip: string, body: unknown = { vehicleId: VEHICLE, reason: "spam" }) {
  return new Request("https://gozuyle.com/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** rpc("fn_rate_limit_hit", …) çağrısının argümanları */
function rateArgs(call = 0) {
  expect(rpc.mock.calls[call][0]).toBe("fn_rate_limit_hit");
  return rpc.mock.calls[call][1] as { p_keys: string[]; p_limits: number[]; p_window_seconds: number[] };
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
  insert.mockReset().mockResolvedValue({ error: null });
  maybeSingle.mockReset().mockResolvedValue({ data: { id: VEHICLE }, error: null });
  rpc.mockReset().mockResolvedValue({ data: 0, error: null });
  getAuthenticatedUserId.mockReset().mockResolvedValue(null);
  ({ POST } = await import("../app/api/reports/route"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/reports", () => {
  it("geçerli bildirimi kaydeder; anonim istek IP kurallarıyla sayılır, IP düz gönderilmez", async () => {
    const response = await POST(reportRequest("203.0.113.1"));
    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith({ vehicle_id: VEHICLE, reporter_id: null, reason: "spam", details: null });

    const args = rateArgs();
    expect(args.p_limits).toEqual([5, 20]);
    expect(args.p_window_seconds).toEqual([60, 3600]);
    for (const key of args.p_keys) {
      expect(key).toMatch(/^reports:ip:[0-9a-f]{64}$/);
      expect(key).not.toContain("203.0.113.1");
    }
  });

  it("giriş yapmış kullanıcı kendi hesabına göre sayılır; IP sınırı gevşek", async () => {
    getAuthenticatedUserId.mockResolvedValue(USER);
    expect((await POST(reportRequest("203.0.113.1"))).status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ reporter_id: USER }));

    const args = rateArgs();
    expect(args.p_limits).toEqual([5, 30, 30]);
    expect(args.p_window_seconds).toEqual([60, 86400, 60]);
    expect(args.p_keys.map((key) => key.split(":")[1])).toEqual(["user", "user", "ip"]);
    expect(args.p_keys.join()).not.toContain(USER);
  });

  it("kalıcı sınır aşılınca 429, Retry-After ve Türkçe mesaj; ilana ve bildirimlere dokunulmaz", async () => {
    rpc.mockResolvedValue({ data: 42, error: null });

    const limited = await POST(reportRequest("203.0.113.1"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("42");
    expect(await limited.json()).toEqual({
      error: {
        code: "rate_limited",
        message: "Kısa sürede çok fazla bildirim gönderildi. Biraz bekleyip tekrar dene.",
      },
    });
    expect(maybeSingle).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("geçersiz istekler de sayılır", async () => {
    expect((await POST(reportRequest("203.0.113.1", "{bozuk"))).status).toBe(400);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("aynı /64 bloğundaki IPv6 adresleri tek özne sayılır", async () => {
    await POST(reportRequest("2a00:1d35:dd80:7501:8c10:3d50:21ac:c7ae"));
    await POST(reportRequest("2a00:1d35:dd80:7501::1"));
    await POST(reportRequest("2a00:1d35:dd80:7502::1"));
    expect(rateArgs(0).p_keys).toEqual(rateArgs(1).p_keys);
    expect(rateArgs(0).p_keys).not.toEqual(rateArgs(2).p_keys);
  });

  it("ön sınır: aynı sunucuya gelen seri, veritabanına gitmeden kesilir", async () => {
    for (let i = 0; i < 30; i++) expect((await POST(reportRequest("203.0.113.1"))).status).toBe(201);

    const limited = await POST(reportRequest("203.0.113.1"));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(rpc).toHaveBeenCalledTimes(30);
    expect(getAuthenticatedUserId).toHaveBeenCalledTimes(30);

    expect((await POST(reportRequest("198.51.100.2"))).status).toBe(201);
  });

  it("sayaç okunamazsa istek geçer ve hata kaydedilir", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    expect((await POST(reportRequest("203.0.113.1"))).status).toBe(201);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
