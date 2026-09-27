import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryScores } from "./content-moderation";

vi.mock("server-only", () => ({}));

const { IMAGE_RETRY_DELAYS_MS, moderateAvatarUpload, moderateImage, moderateImages, moderateText, recordModerationEvent } =
  await import("./content-moderation-server");
const { AVATAR_REJECTED_MESSAGE, AVATAR_UNAVAILABLE_MESSAGE } = await import("./content-moderation");
const { ModerationProviderError } = await import("./moderation-providers");

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

const noWait = { sleep: async () => {} };

describe("moderateAvatarUpload", () => {
  it("temiz fotoğraf kabul edilir; bayt ve tür sağlayıcıya gider", async () => {
    const moderator = image({ sexual: 0.01 });
    expect(await moderateAvatarUpload(moderator, BYTES, "image/jpeg")).toMatchObject({ allowed: true });
    expect(moderator.moderate).toHaveBeenCalledWith(expect.objectContaining({ bytes: BYTES, mimeType: "image/jpeg" }));
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

  it("denetlenemezse 503 (sağlayıcı yok ya da iki kez hata); kullanıcı beklediği için tek, kısa bekleme", async () => {
    expect(await moderateAvatarUpload(null, BYTES, "image/jpeg")).toMatchObject({
      allowed: false,
      status: 503,
      message: AVATAR_UNAVAILABLE_MESSAGE,
    });
    const broken = image(new Error("down"));
    const sleep = vi.fn(async () => {});
    const result = await moderateAvatarUpload(broken, BYTES, "image/webp", { sleep });
    expect(result).toMatchObject({ status: 503 });
    expect(broken.moderate).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls).toEqual([[1_000]]);
    expect(result.verdict.failures).toEqual(["profil fotoğrafı: down"]);
  });
});

describe("moderateImage: yeniden deneme politikası", () => {
  const retryable = (message: string) => new ModerationProviderError(message, { retryable: true });

  it("geçici hatada 2 sn ve 5 sn beklenip yeniden denenir", async () => {
    let calls = 0;
    const moderator = {
      name: "sightengine",
      moderate: vi.fn(async () => {
        if (++calls < 3) throw retryable("sightengine 400 media_error: Could not download media");
        return { sexual: 0.01 };
      }),
    };
    const sleep = vi.fn(async () => {});
    expect(await moderateImage(moderator, { url: "https://x/kapak.jpg", label: "kapak" }, { sleep })).toMatchObject({
      decision: "safe",
    });
    expect(sleep.mock.calls).toEqual([[2_000], [5_000]]);
    expect(IMAGE_RETRY_DELAYS_MS).toEqual([2_000, 5_000]);
  });

  it("kalıcı hata (anahtar, kota, istek) tekrar denenmez; neden görsel adıyla yazılır", async () => {
    const moderator = image(new ModerationProviderError("sightengine 401 credentials_error: bad key"));
    const verdict = await moderateImage(moderator, { url: "https://x/1.jpg", label: "fotoğraf 1" }, noWait);
    expect(moderator.moderate).toHaveBeenCalledTimes(1);
    expect(verdict).toMatchObject({
      decision: "flagged",
      reasons: ["unavailable"],
      provider: "fake",
      failures: ["fotoğraf 1: sightengine 401 credentials_error: bad key"],
    });
  });

  it("bekleme süre sınırını aşacaksa beklenmez", async () => {
    const moderator = image(retryable("sightengine 500: boom"));
    const sleep = vi.fn(async () => {});
    const verdict = await moderateImage(moderator, { url: "https://x/1.jpg" }, { sleep, now: () => 10_000, deadline: 11_000 });
    expect(sleep).not.toHaveBeenCalled();
    expect(moderator.moderate).toHaveBeenCalledTimes(1);
    expect(verdict.failures).toEqual(["görsel: sightengine 500: boom"]);
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

  it("denetlenemeyenler (failures) yalnızca varsa yazılır; 10 satır ve satır uzunluğu sınırı", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const supabase = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient;
    await recordModerationEvent(supabase, {
      subjectType: "listing",
      subjectId: "v1",
      userId: "u1",
      verdict: {
        decision: "flagged",
        reasons: ["unavailable"],
        scores: {},
        provider: "local+sightengine",
        failures: ["kapak: sightengine 400 media_error: 404", ...Array.from({ length: 12 }, (_, i) => `kare ${i}: ${"x".repeat(400)}`)],
      },
    });
    const row = (insert.mock.calls[0] as unknown as [{ failures: string[] }])[0];
    expect(row.failures).toHaveLength(10);
    expect(row.failures[0]).toBe("kapak: sightengine 400 media_error: 404");
    expect(Math.max(...row.failures.map((line) => line.length))).toBe(240);
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
