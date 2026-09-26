import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/reports (app/api/reports/route.ts): istek sınırı ve temel akış.
// Sınırlayıcının durumu modül düzeyinde tutulduğu için her testte route yeniden yüklenir.

vi.mock("server-only", () => ({}));

const insert = vi.fn();
const maybeSingle = vi.fn();
vi.mock("./supabase-server", () => ({
  getAuthenticatedUserId: vi.fn(async () => null),
  getSupabaseAdmin: () => ({
    from: (table: string) =>
      table === "vehicles" ? { select: () => ({ eq: () => ({ maybeSingle }) }) } : { insert },
  }),
}));

const VEHICLE = "11111111-1111-4111-8111-111111111111";

type RouteModule = typeof import("../app/api/reports/route");
let POST: RouteModule["POST"];

function reportRequest(ip: string, body: unknown = { vehicleId: VEHICLE, reason: "spam" }) {
  return new Request("https://gozuyle.com/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.resetModules();
  insert.mockReset().mockResolvedValue({ error: null });
  maybeSingle.mockReset().mockResolvedValue({ data: { id: VEHICLE }, error: null });
  ({ POST } = await import("../app/api/reports/route"));
});

describe("POST /api/reports", () => {
  it("geçerli bildirimi kaydeder", async () => {
    const response = await POST(reportRequest("203.0.113.1"));
    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith({ vehicle_id: VEHICLE, reporter_id: null, reason: "spam", details: null });
  });

  it("aynı IP'den dakikada 5'ten fazla istek 429 ve Türkçe mesajla reddedilir, veritabanına gidilmez", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await POST(reportRequest("203.0.113.1"))).status).toBe(201);
    }

    const limited = await POST(reportRequest("203.0.113.1"));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({
      error: {
        code: "rate_limited",
        message: "Bu bağlantıdan kısa sürede çok fazla bildirim gönderildi. Biraz bekleyip tekrar dene.",
      },
    });
    expect(insert).toHaveBeenCalledTimes(5);
    expect(maybeSingle).toHaveBeenCalledTimes(5);
  });

  it("başka bir IP sınırdan etkilenmez", async () => {
    for (let i = 0; i < 6; i++) await POST(reportRequest("203.0.113.1"));
    expect((await POST(reportRequest("198.51.100.2"))).status).toBe(201);
  });

  it("geçersiz istekler de sınıra sayılır", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await POST(reportRequest("203.0.113.1", "{bozuk"))).status).toBe(400);
    }
    expect((await POST(reportRequest("203.0.113.1"))).status).toBe(429);
    expect(insert).not.toHaveBeenCalled();
  });

  it("pencere dolunca yeniden bildirim kabul edilir", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-26T12:00:00Z"), toFake: ["Date"] });
    try {
      for (let i = 0; i < 5; i++) await POST(reportRequest("203.0.113.1"));
      expect((await POST(reportRequest("203.0.113.1"))).status).toBe(429);

      vi.setSystemTime(new Date("2026-09-26T12:01:00Z"));
      expect((await POST(reportRequest("203.0.113.1"))).status).toBe(201);
    } finally {
      vi.useRealTimers();
    }
  });
});
