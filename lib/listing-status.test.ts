import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OWNER_TRANSITIONS,
  STATUS_LABELS,
  VEHICLE_STATUSES,
  canTransition,
  statusActions,
  type VehicleStatus,
} from "./listing-status";

describe("OWNER_TRANSITIONS", () => {
  it.each<[VehicleStatus, VehicleStatus[]]>([
    ["active", ["sold", "archived"]],
    ["archived", ["active", "sold"]],
    ["draft", ["archived"]],
    ["pending_video", ["archived"]],
    ["sold", []],
  ])("%s → %j", (from, targets) => {
    expect(OWNER_TRANSITIONS[from]).toEqual(targets);
  });

  it("satıcı hiçbir ilanı doğrudan pending_video/draft'a çekemez (bunları sistem yönetir)", () => {
    for (const from of VEHICLE_STATUSES) {
      expect(canTransition(from, "pending_video")).toBe(false);
      expect(canTransition(from, "draft")).toBe(false);
    }
  });

  it("satılan ilan son durumdur", () => {
    for (const to of VEHICLE_STATUSES) expect(canTransition("sold", to)).toBe(false);
  });

  it("aynı duruma geçiş yok", () => {
    for (const status of VEHICLE_STATUSES) expect(canTransition(status, status)).toBe(false);
  });

  it("veritabanındaki set_vehicle_status ile aynı tablo", () => {
    const sql = readFileSync("supabase/migrations/20260925150000_set_vehicle_status_rpc.sql", "utf8");
    const fromSql: Partial<Record<VehicleStatus, string[]>> = {};
    for (const [, from, list] of sql.matchAll(/when '(\w+)'\s+then array\[([^\]]*)\]/g)) {
      fromSql[from as VehicleStatus] = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    }
    for (const status of VEHICLE_STATUSES) {
      // SQL'de listelenmeyen durum "else array[]" dalına düşer: geçiş yok
      expect([...(fromSql[status] ?? [])].sort()).toEqual([...OWNER_TRANSITIONS[status]].sort());
    }
  });
});

describe("statusActions", () => {
  it("yayındaki ilan: satıldı (onaylı) ve yayından kaldır", () => {
    expect(statusActions("active")).toEqual([
      {
        target: "sold",
        label: "Satıldı olarak işaretle",
        confirm: "İlan satıldı olarak işaretlensin mi? Bu işlem geri alınamaz.",
        tone: "danger",
      },
      { target: "archived", label: "Yayından kaldır", confirm: null, tone: "neutral" },
    ]);
  });

  it("yayından kaldırılmış ilan: yayına al ve satıldı", () => {
    expect(statusActions("archived").map((a) => [a.target, a.label])).toEqual([
      ["active", "Yayına al"],
      ["sold", "Satıldı olarak işaretle"],
    ]);
  });

  it("hiç yayınlanmamış ilan geri çekilebilir", () => {
    expect(statusActions("pending_video").map((a) => a.label)).toEqual(["İlanı geri çek"]);
    expect(statusActions("draft").map((a) => a.label)).toEqual(["İlanı geri çek"]);
  });

  it("satılan ilanda aksiyon yok", () => {
    expect(statusActions("sold")).toEqual([]);
  });

  it("geri alınamayan tek işlem onay ister", () => {
    for (const status of VEHICLE_STATUSES) {
      for (const action of statusActions(status)) {
        expect(action.confirm !== null).toBe(action.target === "sold");
      }
    }
  });

  it("her durumun bir etiketi var", () => {
    for (const status of VEHICLE_STATUSES) expect(STATUS_LABELS[status]).toBeTruthy();
  });
});
