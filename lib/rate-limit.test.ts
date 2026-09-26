import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter, rateLimitSubject } from "./rate-limit";

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

describe("rateLimitSubject", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    [" 203.0.113.7 ", "203.0.113.7"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["2a00:1d35:dd80:7501:8c10:3d50:21ac:c7ae", "2a00:1d35:dd80:7501::/64"],
    ["2A00:1D35:DD80:7501::1", "2a00:1d35:dd80:7501::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["2001:0db8:0000:0042::1", "2001:db8:0:42::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["unknown", "unknown"],
  ])("%s → %s", (ip, subject) => {
    expect(rateLimitSubject(ip)).toBe(subject);
  });

  it("aynı /64 içindeki adresler aynı özneye, farklı bloklar farklı özneye düşer", () => {
    expect(rateLimitSubject("2a00:1d35:dd80:7501::a")).toBe(rateLimitSubject("2a00:1d35:dd80:7501:ffff::b"));
    expect(rateLimitSubject("2a00:1d35:dd80:7501::a")).not.toBe(rateLimitSubject("2a00:1d35:dd80:7502::a"));
  });

  it("çözümlenemeyen IPv6 olduğu gibi kalır", () => {
    expect(rateLimitSubject("1::2::3")).toBe("1::2::3");
    expect(rateLimitSubject("zz::1")).toBe("zz::1");
  });
});
