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

const RPC_MIGRATION = "20260925150000_set_vehicle_status_rpc.sql";
// Tabloya doğrudan yazan istekleri denetleyen tetikleyici; davranışı lib/listing-rls.test.ts sınar
const GUARD_MIGRATION = "20260926170000_harden_listing_rls.sql";

function readMigration(name: string): string {
  return readFileSync(`supabase/migrations/${name}`, "utf8");
}

/** SQL'deki `case ... when '<durum>' then array[...]` tablosu */
function transitionsFromSql(sql: string): Partial<Record<VehicleStatus, string[]>> {
  const table: Partial<Record<VehicleStatus, string[]>> = {};
  for (const [, from, list] of sql.matchAll(/when '(\w+)'\s+then array\[([^\]]*)\]/g)) {
    table[from as VehicleStatus] = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]);
  }
  return table;
}

function expectSameAsOwnerTransitions(sql: string) {
  const fromSql = transitionsFromSql(sql);
  expect(Object.keys(fromSql).length).toBeGreaterThan(0);
  for (const status of VEHICLE_STATUSES) {
    // SQL'de listelenmeyen durum "else array[]" dalına düşer: geçiş yok
    expect([...(fromSql[status] ?? [])].sort()).toEqual([...OWNER_TRANSITIONS[status]].sort());
  }
}

describe("OWNER_TRANSITIONS", () => {
  it.each<[VehicleStatus, VehicleStatus[]]>([
    ["active", ["sold", "archived"]],
    ["archived", ["active", "sold"]],
    ["draft", ["archived"]],
    ["pending_video", ["archived"]],
    ["pending_moderation", []],
    ["sold", []],
    ["rejected", []],
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

  it("moderasyonla kaldırılan ilan satıcı için son durumdur; satıcı bu duruma da getiremez", () => {
    for (const status of VEHICLE_STATUSES) {
      expect(canTransition("rejected", status)).toBe(false);
      expect(canTransition(status, "rejected")).toBe(false);
    }
  });

  it("aynı duruma geçiş yok", () => {
    for (const status of VEHICLE_STATUSES) expect(canTransition(status, status)).toBe(false);
  });

  it("veritabanındaki set_vehicle_status ile aynı tablo", () => {
    expectSameAsOwnerTransitions(readMigration(RPC_MIGRATION));
  });

  it("tabloya doğrudan yazan istekleri denetleyen tetikleyiciyle aynı tablo", () => {
    expectSameAsOwnerTransitions(readMigration(GUARD_MIGRATION));
  });
});

describe("statusActions", () => {
  const withVideo = { hasPlayableVideo: true };

  it("yayındaki ilan: satıldı (onaylı) ve yayından kaldır", () => {
    expect(statusActions("active", withVideo)).toEqual([
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
    expect(statusActions("archived", withVideo).map((a) => [a.target, a.label])).toEqual([
      ["active", "Yayına al"],
      ["sold", "Satıldı olarak işaretle"],
    ]);
  });

  it("videosu işlenmemiş ilan yayına alınamaz; diğer aksiyonlar kalır", () => {
    const noVideo = { hasPlayableVideo: false };
    expect(statusActions("archived", noVideo).map((a) => a.target)).toEqual(["sold"]);
    for (const status of VEHICLE_STATUSES) {
      expect(statusActions(status, noVideo).map((a) => a.target)).toEqual(
        statusActions(status, withVideo)
          .map((a) => a.target)
          .filter((target) => target !== "active"),
      );
    }
  });

  it("içerik denetiminden geçmemiş ilan yayına alınamaz", () => {
    for (const moderationStatus of ["pending", "rejected"] as const) {
      expect(statusActions("archived", { hasPlayableVideo: true, moderationStatus }).map((a) => a.target)).toEqual([
        "sold",
      ]);
    }
    expect(
      statusActions("archived", { hasPlayableVideo: true, moderationStatus: "approved" }).map((a) => a.target),
    ).toEqual(["active", "sold"]);
  });

  it("denetim bekleyen ilanda satıcının aksiyonu yok; satıcı ilanı bu duruma da getiremez", () => {
    expect(statusActions("pending_moderation", withVideo)).toEqual([]);
    for (const status of VEHICLE_STATUSES) expect(canTransition(status, "pending_moderation")).toBe(false);
  });

  it("hiç yayınlanmamış ilan geri çekilebilir", () => {
    expect(statusActions("pending_video", withVideo).map((a) => a.label)).toEqual(["İlanı geri çek"]);
    expect(statusActions("draft", withVideo).map((a) => a.label)).toEqual(["İlanı geri çek"]);
  });

  it("satılan ilanda aksiyon yok", () => {
    expect(statusActions("sold", withVideo)).toEqual([]);
  });

  it("geri alınamayan tek işlem onay ister", () => {
    for (const status of VEHICLE_STATUSES) {
      for (const action of statusActions(status, withVideo)) {
        expect(action.confirm !== null).toBe(action.target === "sold");
      }
    }
  });

  it("her durumun bir etiketi var", () => {
    for (const status of VEHICLE_STATUSES) expect(STATUS_LABELS[status]).toBeTruthy();
  });
});
