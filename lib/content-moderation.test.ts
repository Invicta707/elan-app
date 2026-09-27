import { describe, expect, it } from "vitest";
import {
  MAX_FAILURES,
  MAX_FAILURE_LENGTH,
  REJECT_THRESHOLD,
  THUMBNAIL_TIMESTAMP_PCT,
  combineVerdicts,
  coverFrameUrl,
  decide,
  localTextScores,
  moderationReasonCode,
  parseReasonCode,
  probability,
  unavailableVerdict,
  videoFrameTimes,
  videoFrameUrl,
  videoModerationFrames,
  videoModerationTargets,
  type ModerationVerdict,
} from "./content-moderation";

describe("decide: eşikler", () => {
  it("temiz görsel: safe", () => {
    expect(decide({ sexual: 0.01, violence: 0.02, gore: 0.01, weapon: 0.03 }, "sightengine")).toEqual({
      decision: "safe",
      reasons: [],
      scores: { sexual: 0.01, violence: 0.02, gore: 0.01, weapon: 0.03 },
      provider: "sightengine",
    });
  });

  it.each(["sexual", "violence", "gore", "weapon"] as const)("%s > %%60: rejected", (category) => {
    expect(decide({ [category]: 0.61 }, "x")).toMatchObject({ decision: "rejected", reasons: [category] });
  });

  it("tam %60 ret sayılmaz (eşik 'büyüktür'), incelemeye düşer", () => {
    expect(REJECT_THRESHOLD).toBe(0.6);
    expect(decide({ sexual: 0.6 }, "x")).toMatchObject({ decision: "flagged", reasons: ["sexual"] });
  });

  it("%40–60 arası: flagged (insan incelemesi)", () => {
    expect(decide({ violence: 0.45 }, "x")).toMatchObject({ decision: "flagged", reasons: ["violence"] });
    expect(decide({ violence: 0.4 }, "x").decision).toBe("safe");
  });

  it("ret nedenleri puana göre sıralı; incelemedekiler rette nedenlere girmez", () => {
    expect(decide({ weapon: 0.7, sexual: 0.95, gore: 0.5 }, "x")).toMatchObject({
      decision: "rejected",
      reasons: ["sexual", "weapon"],
    });
  });

  it("müstehcen görünüm tek başına reddetmez, yalnızca incelemeye düşer", () => {
    expect(decide({ suggestive: 0.99 }, "x")).toMatchObject({ decision: "flagged", reasons: ["suggestive"] });
    expect(decide({ suggestive: 0.5 }, "x").decision).toBe("safe");
  });

  it("reşit olmayanlarla ilgili içerikte eşik çok daha düşük", () => {
    expect(decide({ sexual_minors: 0.25 }, "x").decision).toBe("rejected");
    expect(decide({ sexual_minors: 0.1 }, "x").decision).toBe("flagged");
  });

  it("bozuk puanlar 0 sayılır, 1'in üstü 1'e çekilir", () => {
    expect(probability(Number.NaN)).toBe(0);
    expect(probability("0.9")).toBe(0);
    expect(probability(7)).toBe(1);
    expect(probability(-1)).toBe(0);
    expect(decide({ sexual: Number.NaN }, "x").decision).toBe("safe");
  });
});

describe("combineVerdicts", () => {
  const v = (decision: ModerationVerdict["decision"], reasons: ModerationVerdict["reasons"], scores = {}, provider = "p"): ModerationVerdict => ({
    decision,
    reasons,
    scores,
    provider,
  });

  it("en kötü karar geçerli; nedenler o karardan", () => {
    const combined = combineVerdicts([
      v("safe", [], { sexual: 0.1 }),
      v("flagged", ["gore"], { gore: 0.5 }),
      v("rejected", ["weapon"], { weapon: 0.9 }),
      v("rejected", ["sexual"], { sexual: 0.8 }),
    ]);
    expect(combined).toEqual({
      decision: "rejected",
      reasons: ["weapon", "sexual"],
      scores: { sexual: 0.8, gore: 0.5, weapon: 0.9 },
      provider: "p",
    });
  });

  it("denetlenemeyen kare tüm ilanı incelemeye düşürür (kapalı başarısızlık)", () => {
    expect(combineVerdicts([v("safe", []), unavailableVerdict("sightengine")])).toMatchObject({
      decision: "flagged",
      reasons: ["unavailable"],
    });
  });

  it("hiç denetim yoksa safe; sağlayıcılar birleşir", () => {
    expect(combineVerdicts([]).decision).toBe("safe");
    expect(combineVerdicts([v("safe", [], {}, "local"), v("safe", [], {}, "openai")]).provider).toBe("local+openai");
  });
});

describe("metin", () => {
  it("temel filtrenin kategorisi 1 puan alır ve reddedilir", () => {
    expect(localTextScores("siktir")).toEqual({ profanity: 1 });
    expect(decide(localTextScores("seni öldürürüm"), "local")).toMatchObject({
      decision: "rejected",
      reasons: ["harassment"],
    });
    expect(localTextScores("Sıkıntısız araç")).toEqual({});
  });
});

describe("moderation_reason", () => {
  it("ret: en güçlü neden; inceleme: review: + nedenler; temiz: null", () => {
    expect(moderationReasonCode(decide({ weapon: 0.7, sexual: 0.95 }, "x"))).toBe("sexual");
    expect(moderationReasonCode(combineVerdicts([decide({ gore: 0.5 }, "x"), unavailableVerdict("x")]))).toBe(
      "review:gore,unavailable",
    );
    expect(moderationReasonCode(decide({}, "x"))).toBeNull();
  });

  it("geri okunur; bilinmeyen parçalar atılır", () => {
    expect(parseReasonCode("sexual")).toEqual(["sexual"]);
    expect(parseReasonCode("review:gore,unavailable,toString,xyz")).toEqual(["gore", "unavailable"]);
    expect(parseReasonCode("manual")).toEqual([]);
    expect(parseReasonCode("ai:safe")).toEqual([]);
    expect(parseReasonCode(null)).toEqual([]);
  });
});

describe("video kareleri", () => {
  it("süre 5 eşit parçaya bölünür, her parçanın ortası", () => {
    expect(videoFrameTimes(60)).toEqual([6, 18, 30, 42, 54]);
    expect(videoFrameTimes(10)).toEqual([1, 3, 5, 7, 9]);
  });

  it("kısa videoda aynı saniye tekrar edilmez", () => {
    expect(videoFrameTimes(3)).toEqual([0, 1, 2]);
  });

  it("süre bilinmiyorsa ilk saniyeler", () => {
    expect(videoFrameTimes(null)).toEqual([1, 3, 6]);
    expect(videoFrameTimes(0)).toEqual([1, 3, 6]);
  });

  const THUMB = "https://customer-abc.cloudflarestream.com/uid123/thumbnails/thumbnail.jpg";

  it("Cloudflare kare adresi: time ve height", () => {
    expect(videoFrameUrl(THUMB, 12.7)).toBe(`${THUMB}?time=12s&height=480`);
    expect(videoFrameUrl(`${THUMB}?time=1s`, 30)).toBe(`${THUMB}?time=30s&height=480`);
  });

  it("kapak + örnek kareler; kapak zamanıyla istenir (zamansız adres ready'den ~40 sn sonra hazır oluyor)", () => {
    expect(videoModerationFrames(THUMB, 10)).toEqual([
      `${THUMB}?time=2s&height=480`,
      ...[1, 3, 5, 7, 9].map((t) => `${THUMB}?time=${t}s&height=480`),
    ]);
    expect(videoModerationFrames(THUMB, 10).some((url) => !url.includes("time="))).toBe(false);
  });

  it("kapak zamanı: sürenin %20'si, tek ondalık (Cloudflare'in thumbnailTimestampPct karesi)", () => {
    expect(THUMBNAIL_TIMESTAMP_PCT).toBe(0.2);
    expect(coverFrameUrl(THUMB, 28)).toBe(`${THUMB}?time=5.6s&height=480`);
    expect(coverFrameUrl(THUMB, 2)).toBe(`${THUMB}?time=0.4s&height=480`);
    expect(coverFrameUrl(THUMB, 11)).toBe(`${THUMB}?time=2.2s&height=480`);
    expect(coverFrameUrl(THUMB, 37, 720)).toBe(`${THUMB}?time=7.4s&height=720`);
    // Adresteki eski zaman değişir
    expect(coverFrameUrl(`${THUMB}?time=1s`, 15)).toBe(`${THUMB}?time=3s&height=480`);
  });

  it("süre bilinmiyorsa kapak zamansız adrese düşer", () => {
    expect(coverFrameUrl(THUMB, null)).toBe(`${THUMB}?height=480`);
    expect(coverFrameUrl(THUMB, 0)).toBe(`${THUMB}?height=480`);
    expect(coverFrameUrl(THUMB, Number.NaN)).toBe(`${THUMB}?height=480`);
  });

  it("kareler adlarıyla (denetlenemezse kayda yazılır); aynı adres bir kez", () => {
    expect(videoModerationTargets(THUMB, 3)).toEqual([
      { url: `${THUMB}?time=0.6s&height=480`, label: "kapak" },
      { url: `${THUMB}?time=0s&height=480`, label: "kare 0 sn" },
      { url: `${THUMB}?time=1s&height=480`, label: "kare 1 sn" },
      { url: `${THUMB}?time=2s&height=480`, label: "kare 2 sn" },
    ]);
    // Kapak bir ara kareye denk gelirse (5 sn → kapak 1 sn, kareler 0–4) o kare tekrar istenmez
    expect(videoModerationTargets(THUMB, 5).map((f) => f.label)).toEqual([
      "kapak",
      "kare 0 sn",
      "kare 2 sn",
      "kare 3 sn",
      "kare 4 sn",
    ]);
    expect(videoModerationTargets(THUMB, 15).map((f) => f.label)).toEqual([
      "kapak",
      "kare 1 sn",
      "kare 4 sn",
      "kare 7 sn",
      "kare 10 sn",
      "kare 13 sn",
    ]);
  });

  it("ara kareler videonun sonundan önce (süre yuvarlansa da)", () => {
    for (const duration of [1, 2, 3, 4, 5, 9, 10, 28, 60]) {
      for (const t of videoFrameTimes(duration)) expect(t).toBeLessThan(duration);
    }
  });
});

describe("denetlenemeyenler (failures)", () => {
  it("unavailableVerdict nedeni taşır ve uzun metni kısaltır", () => {
    expect(unavailableVerdict("sightengine", "kapak: sightengine 400 media_error")).toEqual({
      decision: "flagged",
      reasons: ["unavailable"],
      scores: {},
      provider: "sightengine",
      failures: ["kapak: sightengine 400 media_error"],
    });
    expect(unavailableVerdict("x", "a".repeat(500)).failures?.[0]).toHaveLength(MAX_FAILURE_LENGTH);
    expect(unavailableVerdict("none")).not.toHaveProperty("failures");
  });

  it("combineVerdicts nedenleri birleştirir, tekrarı atar, en fazla 10 satır", () => {
    const combined = combineVerdicts([
      decide({}, "local"),
      unavailableVerdict("s", "kapak: 404"),
      unavailableVerdict("s", "kapak: 404"),
      ...Array.from({ length: 12 }, (_, i) => unavailableVerdict("s", `kare ${i} sn: 500`)),
    ]);
    expect(combined.failures?.[0]).toBe("kapak: 404");
    expect(combined.failures).toHaveLength(MAX_FAILURES);
    expect(combineVerdicts([decide({}, "local")])).not.toHaveProperty("failures");
  });
});
