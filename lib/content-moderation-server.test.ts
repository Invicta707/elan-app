import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryScores } from "./content-moderation";

vi.mock("server-only", () => ({}));

const { moderateAvatarUpload, moderateImages, moderateText, recordModerationEvent } = await import(
  "./content-moderation-server"
);
const { AVATAR_REJECTED_MESSAGE, AVATAR_UNAVAILABLE_MESSAGE } = await import("./content-moderation");

const image = (result: CategoryScores | Error) => ({
  name: "fake",
  moderate: vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  }),
});
const BYTES = new Uint8Array([0xff, 0xd8, 0xff]);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("moderateAvatarUpload", () => {
  it("temiz fotoğraf kabul edilir; bayt ve tür sağlayıcıya gider", async () => {
    const moderator = image({ sexual: 0.01 });
    expect(await moderateAvatarUpload(moderator, BYTES, "image/jpeg")).toMatchObject({ allowed: true });
    expect(moderator.moderate).toHaveBeenCalledWith({ bytes: BYTES, mimeType: "image/jpeg" });
  });

  it("kurala aykırı ya da şüpheli fotoğraf 422", async () => {
    expect(await moderateAvatarUpload(image({ sexual: 0.9 }), BYTES, "image/jpeg")).toMatchObject({
      allowed: false,
      status: 422,
      message: AVATAR_REJECTED_MESSAGE,
    });
    // İnceleme kuyruğu yok: şüpheli de reddedilir
    expect(await moderateAvatarUpload(image({ weapon: 0.5 }), BYTES, "image/jpeg")).toMatchObject({ status: 422 });
  });

  it("denetlenemezse 503 (sağlayıcı yok ya da iki kez hata)", async () => {
    expect(await moderateAvatarUpload(null, BYTES, "image/jpeg")).toMatchObject({
      allowed: false,
      status: 503,
      message: AVATAR_UNAVAILABLE_MESSAGE,
    });
    const broken = image(new Error("down"));
    expect(await moderateAvatarUpload(broken, BYTES, "image/webp")).toMatchObject({ status: 503 });
    expect(broken.moderate).toHaveBeenCalledTimes(2);
  });
});

describe("moderateImages", () => {
  it("görsel yoksa safe; sağlayıcı yoksa denetlenemedi", async () => {
    expect((await moderateImages(image({}), [])).decision).toBe("safe");
    expect(await moderateImages(null, [{ url: "https://x/1.jpg" }])).toMatchObject({ decision: "flagged", reasons: ["unavailable"] });
  });

  it("aynı anda en fazla 4 istek", async () => {
    let active = 0;
    let peak = 0;
    const slow = {
      name: "slow",
      moderate: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return {};
      },
    };
    const inputs = Array.from({ length: 10 }, (_, i) => ({ url: `https://x/${i}.jpg` }));
    expect((await moderateImages(slow, inputs)).decision).toBe("safe");
    expect(peak).toBe(4);
  });
});

describe("moderateText", () => {
  const text = (result: CategoryScores | Error) => ({
    name: "openai",
    moderate: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  });

  it("temel filtre önce: takılırsa sağlayıcıya gidilmez", async () => {
    const provider = text({});
    expect(await moderateText(provider, "aq", { onProviderError: "flag" })).toMatchObject({
      decision: "rejected",
      provider: "local",
    });
    expect(provider.moderate).not.toHaveBeenCalled();
  });

  it("sağlayıcı hatası: ilan metninde inceleme, mesajda geçer", async () => {
    expect(await moderateText(text(new Error("503")), "Merhaba", { onProviderError: "flag" })).toMatchObject({
      decision: "flagged",
      reasons: ["unavailable"],
    });
    expect((await moderateText(text(new Error("503")), "Merhaba", { onProviderError: "allow" })).decision).toBe("safe");
  });

  it("boş metin sağlayıcıya gitmez", async () => {
    const provider = text({});
    expect((await moderateText(provider, "  ", { onProviderError: "flag" })).decision).toBe("safe");
    expect(provider.moderate).not.toHaveBeenCalled();
  });
});

describe("recordModerationEvent", () => {
  it("karar, nedenler ve yuvarlanmış puanlar yazılır; içerik yazılmaz", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const supabase = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient;
    await recordModerationEvent(supabase, {
      subjectType: "listing",
      subjectId: "v1",
      userId: "u1",
      verdict: { decision: "rejected", reasons: ["sexual"], scores: { sexual: 0.912345678 }, provider: "sightengine" },
    });
    expect(supabase.from).toHaveBeenCalledWith("content_moderation_events");
    expect(insert).toHaveBeenCalledWith({
      subject_type: "listing",
      subject_id: "v1",
      user_id: "u1",
      moderator_id: null,
      provider: "sightengine",
      decision: "rejected",
      reasons: ["sexual"],
      scores: { sexual: 0.9123 },
    });
  });

  it("yazılamazsa isteği düşürmez", async () => {
    const supabase = { from: () => ({ insert: async () => ({ error: { message: "boom" } }) }) } as unknown as SupabaseClient;
    await expect(
      recordModerationEvent(supabase, {
        subjectType: "avatar",
        subjectId: null,
        userId: "u1",
        verdict: { decision: "safe", reasons: [], scores: {}, provider: "x" },
      }),
    ).resolves.toBeUndefined();
  });
});
