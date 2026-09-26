import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import { MAX_REPORT_DETAILS, REPORT_REASONS, parseReportInput, submitReport } from "./reports";

const VEHICLE = "11111111-1111-4111-8111-111111111111";

describe("parseReportInput", () => {
  it("geçerli isteği kabul eder, açıklamayı kırpar", () => {
    expect(parseReportInput({ vehicleId: VEHICLE, reason: "fraud", details: "  Kapora istiyor  " })).toEqual({
      ok: true,
      value: { vehicleId: VEHICLE, reason: "fraud", details: "Kapora istiyor" },
    });
  });

  it("boş ya da eksik açıklama null olur", () => {
    for (const details of [undefined, "", "   ", 42]) {
      const result = parseReportInput({ vehicleId: VEHICLE, reason: "spam", details });
      expect(result.ok && result.value.details).toBeNull();
    }
  });

  it("geçersiz ilan id'si", () => {
    for (const body of [{ vehicleId: "abc", reason: "spam" }, { reason: "spam" }, null, "metin"]) {
      expect(parseReportInput(body)).toMatchObject({ ok: false, code: "invalid_vehicle" });
    }
  });

  it("listede olmayan neden; nesne prototipi adları da kabul edilmez", () => {
    for (const reason of ["hakaret", "", undefined, "toString", "__proto__", "constructor"]) {
      expect(parseReportInput({ vehicleId: VEHICLE, reason })).toMatchObject({ ok: false, code: "invalid_reason" });
    }
  });

  it("açıklama sınırı", () => {
    const atLimit = "a".repeat(MAX_REPORT_DETAILS);
    expect(parseReportInput({ vehicleId: VEHICLE, reason: "other", details: atLimit }).ok).toBe(true);
    expect(parseReportInput({ vehicleId: VEHICLE, reason: "other", details: atLimit + "a" })).toMatchObject({
      ok: false,
      code: "details_too_long",
    });
  });
});

describe("REPORT_REASONS", () => {
  it("veritabanındaki CHECK kısıtıyla aynı", () => {
    const sql = readFileSync("supabase/migrations/20260925230000_reports.sql", "utf8");
    const list = sql.match(/check \(reason in \(([^)]*)\)\)/)?.[1];
    const dbReasons = [...(list ?? "").matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(dbReasons.sort()).toEqual(Object.keys(REPORT_REASONS).sort());
  });
});

describe("submitReport", () => {
  const input = { vehicleId: VEHICLE, reason: "fraud" as const, details: null };

  function respond(status: number, body: unknown) {
    return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
  }

  it("oturum varsa anahtarı ekler", async () => {
    const fetchImpl = respond(201, { ok: true });
    await expect(submitReport(input, "token-1", fetchImpl)).resolves.toEqual({ ok: true, already: false });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/reports");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer token-1");
    expect(JSON.parse(init?.body as string)).toEqual(input);
  });

  it("oturum yoksa anonim gönderir", async () => {
    const fetchImpl = respond(201, { ok: true });
    await submitReport(input, null, fetchImpl);
    expect(fetchImpl.mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");
  });

  it("daha önce bildirilmişse 'already'", async () => {
    await expect(submitReport(input, "t", respond(200, { ok: true, alreadyReported: true }))).resolves.toEqual({
      ok: true,
      already: true,
    });
  });

  it("sunucunun mesajını iletir; mesaj yoksa genel metin", async () => {
    await expect(
      submitReport(input, null, respond(404, { error: { message: "Bildirilecek ilan bulunamadı." } })),
    ).resolves.toEqual({ ok: false, message: "Bildirilecek ilan bulunamadı." });
    const noBody = vi.fn<typeof fetch>(async () => new Response("bozuk", { status: 500 }));
    await expect(submitReport(input, null, noBody)).resolves.toMatchObject({ ok: false });
  });

  it("ağ hatası", async () => {
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(submitReport(input, null, offline)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("Bağlantını kontrol"),
    });
  });
});
