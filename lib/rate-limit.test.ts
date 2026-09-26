import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "./rate-limit";

function limiterAt(start: number, options: { limit: number; windowMs: number; maxKeys?: number }) {
  const clock = { now: start };
  const check = createRateLimiter({ ...options, now: () => clock.now });
  return { check, clock };
}

describe("createRateLimiter", () => {
  it("pencere içinde sınıra kadar izin verir, sonra bekleme süresiyle reddeder", () => {
    const { check, clock } = limiterAt(0, { limit: 3, windowMs: 60_000 });

    expect(check("1.1.1.1")).toEqual({ ok: true, remaining: 2 });
    clock.now = 10_000;
    expect(check("1.1.1.1")).toEqual({ ok: true, remaining: 1 });
    expect(check("1.1.1.1")).toEqual({ ok: true, remaining: 0 });
    expect(check("1.1.1.1")).toEqual({ ok: false, retryAfterSeconds: 50 });
  });

  it("kayan pencere: en eski istek pencereden çıkınca bir hak açılır", () => {
    const { check, clock } = limiterAt(0, { limit: 2, windowMs: 60_000 });
    check("ip");
    clock.now = 30_000;
    check("ip");

    clock.now = 59_999;
    expect(check("ip").ok).toBe(false);
    clock.now = 60_000;
    expect(check("ip")).toEqual({ ok: true, remaining: 0 });
    expect(check("ip")).toEqual({ ok: false, retryAfterSeconds: 30 });
  });

  it("reddedilen istekler sayılmaz, bekleme süresini uzatmaz", () => {
    const { check, clock } = limiterAt(0, { limit: 1, windowMs: 60_000 });
    check("ip");
    for (let t = 1_000; t < 60_000; t += 1_000) {
      clock.now = t;
      expect(check("ip").ok).toBe(false);
    }
    clock.now = 60_000;
    expect(check("ip").ok).toBe(true);
  });

  it("anahtarlar birbirinden bağımsızdır", () => {
    const { check } = limiterAt(0, { limit: 1, windowMs: 60_000 });
    expect(check("a").ok).toBe(true);
    expect(check("a").ok).toBe(false);
    expect(check("b").ok).toBe(true);
  });

  it("anahtar sınırı aşılınca en uzun süredir istek gelmeyen anahtar unutulur", () => {
    const { check } = limiterAt(0, { limit: 1, windowMs: 60_000, maxKeys: 2 });
    check("a");
    check("b");
    expect(check("a").ok).toBe(false); // a en sona taşındı; en eski artık b
    check("c"); // b atılır
    expect(check("a").ok).toBe(false);
    expect(check("b").ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("x-real-ip önceliklidir", () => {
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe(
      "203.0.113.7",
    );
  });

  it("yoksa x-forwarded-for'daki ilk adres kullanılır", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.1" }))).toBe("198.51.100.1");
  });

  it("başlık yoksa ya da boşsa unknown", () => {
    expect(clientIp(new Headers())).toBe("unknown");
    expect(clientIp(new Headers({ "x-real-ip": " ", "x-forwarded-for": "" }))).toBe("unknown");
  });
});
