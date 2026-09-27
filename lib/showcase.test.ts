import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import { formatCount, formatTilePrice, isContentRejected, isLive, showcaseStats, tileBadge } from "./showcase";

describe("formatTilePrice", () => {
  it.each([
    [850000, "₺850.000"],
    [999999, "₺999.999"],
    [1000000, "₺1 Mn"],
    [1250000, "₺1,25 Mn"],
    [1259999, "₺1,25 Mn"],
    [12500000, "₺12,5 Mn"],
  ])("%s → %s", (price, label) => {
    expect(formatTilePrice(price, "TRY")).toBe(label);
  });
});

describe("formatCount", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1200, "1,2 B"],
    [3_400_000, "3,4 Mn"],
    [-5, "0"],
  ])("%s → %s", (count, label) => {
    expect(formatCount(count)).toBe(label);
  });
});

describe("showcaseStats", () => {
  it("ilan, yayında ve toplam izlenme", () => {
    expect(
      showcaseStats([
        { status: "active", viewsCount: 100 },
        { status: "archived", viewsCount: 20 },
        { status: "active", viewsCount: 5 },
      ]),
    ).toEqual({ total: 3, live: 2, views: 125 });
    expect(isLive("pending_video")).toBe(false);
  });
});

describe("içerik denetimi etiketleri", () => {
  it.each([
    ["active", "approved", null],
    ["pending_video", "pending", "Yayında Değil"],
    ["pending_moderation", "pending", "İnceleniyor"],
    ["rejected", "rejected", "Yayınlanmadı"],
    // Moderasyonun bildirim sonrası kaldırdığı ilan: içerik denetiminden geçmişti
    ["rejected", "approved", "Yayında Değil"],
    ["archived", "approved", "Yayında Değil"],
  ] as const)("%s + %s → %s", (status, moderationStatus, badge) => {
    expect(tileBadge({ status, moderationStatus })).toBe(badge);
  });

  it("yalnızca içerik denetiminin reddettiği ilan \"yayınlanmadı\" uyarısı alır", () => {
    expect(isContentRejected({ status: "rejected", moderationStatus: "rejected" })).toBe(true);
    expect(isContentRejected({ status: "rejected", moderationStatus: "approved" })).toBe(false);
    expect(isContentRejected({ status: "pending_moderation", moderationStatus: "pending" })).toBe(false);
  });
});
