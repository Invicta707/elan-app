import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import {
  MAX_DISMISS_REPORTS,
  fetchModerationQueue,
  parseAdminEmails,
  parseModerationAction,
  submitModerationAction,
  toModerationQueue,
  type OpenReportRow,
} from "./moderation";
import type { MyListingRow } from "./my-listings";

const VEHICLE_A = "11111111-1111-4111-8111-111111111111";
const VEHICLE_B = "22222222-2222-4222-8222-222222222222";
const REPORT_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPORT_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("parseAdminEmails", () => {
  it("virgülle ayrılmış listeyi kırpar ve küçük harfe çevirir", () => {
    expect(parseAdminEmails(" Admin@Gozuyle.com, ikinci@ornek.com ,,")).toEqual(
      new Set(["admin@gozuyle.com", "ikinci@ornek.com"]),
    );
  });

  it("tanımsız ya da boş değer kimseye yetki vermez", () => {
    expect(parseAdminEmails(undefined).size).toBe(0);
    expect(parseAdminEmails("  , ").size).toBe(0);
  });
});

describe("parseModerationAction", () => {
  it("ilanı kaldırma", () => {
    expect(parseModerationAction({ action: "remove_listing", vehicleId: VEHICLE_A })).toEqual({
      ok: true,
      value: { action: "remove_listing", vehicleId: VEHICLE_A },
    });
  });

  it("bildirim kapatma; tekrar eden id'ler bir kez sayılır", () => {
    expect(parseModerationAction({ action: "dismiss", reportIds: [REPORT_1, REPORT_2, REPORT_1] })).toEqual({
      ok: true,
      value: { action: "dismiss", reportIds: [REPORT_1, REPORT_2] },
    });
  });

  it("bilinmeyen işlem", () => {
    for (const body of [{ action: "delete_user" }, { action: "toString" }, {}, null, "metin"]) {
      expect(parseModerationAction(body)).toMatchObject({ ok: false, code: "invalid_action" });
    }
  });

  it("geçersiz ilan id'si", () => {
    for (const vehicleId of ["abc", undefined, 42]) {
      expect(parseModerationAction({ action: "remove_listing", vehicleId })).toMatchObject({
        ok: false,
        code: "invalid_vehicle",
      });
    }
  });

  it("geçersiz bildirim listesi: boş, dizi değil, geçersiz id ya da sınırın üstünde", () => {
    const tooMany = Array.from({ length: MAX_DISMISS_REPORTS + 1 }, () => REPORT_1);
    for (const reportIds of [[], REPORT_1, [REPORT_1, "abc"], tooMany, undefined]) {
      expect(parseModerationAction({ action: "dismiss", reportIds })).toMatchObject({
        ok: false,
        code: "invalid_reports",
      });
    }
  });
});

function vehicleRow(id: string, brand: string, model: string): MyListingRow {
  return {
    id,
    status: "active",
    year: 2019,
    price: "850000",
    currency: "TRY",
    mileage_km: 90000,
    city: "İzmir",
    created_at: "2026-09-20T10:00:00Z",
    brand: { name: brand },
    model: { name: model },
    images: [],
    videos: [{ status: "ready", hls_url: "https://cf/a.m3u8", thumbnail_url: "https://cf/a.jpg" }],
  };
}

describe("toModerationQueue", () => {
  it("bildirimleri ilan başına toplar; en eski bildirimi olan ilan önce", () => {
    const a = vehicleRow(VEHICLE_A, "Peugeot", "208");
    const b = vehicleRow(VEHICLE_B, "Fiat", "Egea");
    const rows: OpenReportRow[] = [
      { id: "r1", reason: "fraud", details: "Kapora istiyor", created_at: "2026-09-26T08:00:00Z", vehicle: b },
      { id: "r2", reason: "spam", details: null, created_at: "2026-09-26T09:00:00Z", vehicle: a },
      { id: "r3", reason: "wrong_info", details: null, created_at: "2026-09-26T10:00:00Z", vehicle: b },
      { id: "r4", reason: "other", details: null, created_at: "2026-09-26T11:00:00Z", vehicle: null },
    ];

    const queue = toModerationQueue(rows);
    expect(queue.map((item) => [item.vehicle.title, item.reports.map((r) => r.id)])).toEqual([
      ["Fiat Egea", ["r1", "r3"]],
      ["Peugeot 208", ["r2"]],
    ]);
    expect(queue[0].vehicle).toMatchObject({ id: VEHICLE_B, price: 850000, coverUrl: "https://cf/a.jpg" });
    expect(queue[0].reports[0]).toEqual({
      id: "r1",
      reason: "fraud",
      details: "Kapora istiyor",
      createdAt: "2026-09-26T08:00:00Z",
    });
  });
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("fetchModerationQueue / submitModerationAction", () => {
  it("kuyruğu oturum anahtarıyla ve önbelleksiz ister", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { items: [] }));
    expect(await fetchModerationQueue("tok", fetchImpl)).toEqual({ ok: true, items: [] });
    expect(fetchImpl).toHaveBeenCalledWith("/api/admin/reports", {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: "Bearer tok" },
      body: undefined,
    });
  });

  it("işlemi JSON olarak gönderir ve kapatılan bildirim sayısını döner", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true, resolved: 2 }));
    const input = { action: "remove_listing", vehicleId: VEHICLE_A } as const;
    expect(await submitModerationAction(input, "tok", fetchImpl)).toEqual({ ok: true, resolved: 2 });
    expect(fetchImpl).toHaveBeenCalledWith("/api/admin/reports", {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("sunucu hatasında durum kodu ve mesajı; ağ hatasında durum 0", async () => {
    const forbidden = vi.fn(async () =>
      jsonResponse(403, { error: { code: "forbidden", message: "Bu sayfaya erişim yetkin yok." } }),
    );
    expect(await fetchModerationQueue("tok", forbidden)).toEqual({
      ok: false,
      status: 403,
      message: "Bu sayfaya erişim yetkin yok.",
    });

    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await fetchModerationQueue("tok", offline)).toMatchObject({ ok: false, status: 0 });

    const htmlError = vi.fn(async () => new Response("<html>", { status: 502 }));
    expect(await submitModerationAction({ action: "dismiss", reportIds: [REPORT_1] }, "tok", htmlError)).toMatchObject({
      ok: false,
      status: 502,
    });
  });
});
