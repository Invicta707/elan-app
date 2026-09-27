import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryScores } from "./content-moderation";

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabase: {} }));
vi.mock("./supabase-server", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("./cloudflare", () => ({ deleteStreamVideo: vi.fn() }));

const {
  createListingModerationStore,
  decideListingManually,
  evaluateListing,
  moderateListing,
  toListingSnapshot,
} = await import("./listing-moderation");
type Snapshot = import("./listing-moderation").ListingSnapshot;
type Store = import("./listing-moderation").ListingModerationStore;
type ImageModerator = import("./moderation-providers").ImageModerator;
type TextModerator = import("./moderation-providers").TextModerator;

const VEHICLE = "11111111-1111-4111-8111-111111111111";
const SELLER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "99999999-9999-4999-8999-999999999999";
const THUMB = "https://customer-abc.cloudflarestream.com/uid-1/thumbnails/thumbnail.jpg";
const PHOTO = `https://proj.supabase.co/storage/v1/object/public/vehicle-photos/${VEHICLE}/0.jpeg`;

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: VEHICLE,
    sellerId: SELLER,
    status: "pending_moderation",
    moderationStatus: "pending",
    moderationReason: null,
    description: "Bakımlı, sıkıntısız araç",
    city: "İstanbul",
    photoUrls: [PHOTO],
    readyVideos: [{ thumbnailUrl: THUMB, durationSeconds: 10 }],
    streamUids: ["uid-1"],
    ...overrides,
  };
}

function fakeStore(listing: Snapshot | null, { publishes = true } = {}) {
  const events: string[] = [];
  const recorded: Parameters<Store["record"]>[0][] = [];
  const store: Store = {
    load: vi.fn(async () => listing),
    approve: vi.fn(async (_id, reason) => {
      events.push(`approve:${reason}`);
      return { published: publishes };
    }),
    hold: vi.fn(async (_id, reason) => {
      events.push(`hold:${reason}`);
    }),
    reject: vi.fn(async (_id, reason) => {
      events.push(`reject:${reason}`);
    }),
    purgeMedia: vi.fn(async () => {
      events.push("purge");
    }),
    record: vi.fn(async (event) => {
      recorded.push(event);
    }),
  };
  return { store, events, recorded };
}

/** Adrese göre puan veren sahte görsel sağlayıcı */
function imageModerator(scoresFor: (url: string) => CategoryScores | Error = () => ({})): ImageModerator & { seen: string[] } {
  const seen: string[] = [];
  return {
    name: "fake-vision",
    seen,
    async moderate(input) {
      const url = "url" in input ? input.url : "bytes";
      seen.push(url);
      const result = scoresFor(url);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const textModerator = (scores: CategoryScores | Error = {}): TextModerator => ({
  name: "fake-text",
  moderate: vi.fn(async () => {
    if (scores instanceof Error) throw scores;
    return scores;
  }),
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("evaluateListing", () => {
  it("video kareleri (kapak + 5) önce, sonra fotoğraflar denetlenir", async () => {
    const image = imageModerator();
    const verdict = await evaluateListing(snapshot(), { image, text: null });
    expect(verdict.decision).toBe("safe");
    expect(image.seen).toHaveLength(7);
    expect(image.seen[0]).toBe(`${THUMB}?height=480`);
    expect(image.seen).toContain(`${THUMB}?time=5s&height=480`);
    expect(image.seen.at(-1)).toBe(PHOTO);
  });

  it("açıklama temel filtreye takılırsa görseller için sağlayıcı çağrılmaz", async () => {
    const image = imageModerator();
    const text = textModerator();
    const verdict = await evaluateListing(snapshot({ description: "Satılık tabanca da var" }), { image, text });
    expect(verdict).toMatchObject({ decision: "rejected", reasons: ["illegal"], provider: "local" });
    expect(image.seen).toEqual([]);
    expect(text.moderate).not.toHaveBeenCalled();
  });

  it("OpenAI metni reddederse ilan reddedilir", async () => {
    const verdict = await evaluateListing(snapshot(), {
      image: imageModerator(),
      text: textModerator({ harassment: 0.92 }),
    });
    expect(verdict).toMatchObject({ decision: "rejected", reasons: ["harassment"] });
  });

  it("görsel sağlayıcı tanımlı değilse denetlenemedi: flagged (yayına girmez)", async () => {
    expect(await evaluateListing(snapshot(), { image: null, text: null })).toMatchObject({
      decision: "flagged",
      reasons: ["unavailable"],
    });
  });

  it("kapağı olmayan video denetlenemedi sayılır", async () => {
    const verdict = await evaluateListing(snapshot({ readyVideos: [{ thumbnailUrl: null, durationSeconds: 10 }], photoUrls: [] }), {
      image: imageModerator(),
      text: null,
    });
    expect(verdict).toMatchObject({ decision: "flagged", reasons: ["unavailable"] });
  });

  it("bir kare reddedilince yeni istek başlatılmaz", async () => {
    const image = imageModerator((url) => (url.includes("height=480") && !url.includes("time") ? { sexual: 0.97 } : {}));
    const verdict = await evaluateListing(snapshot(), { image, text: null });
    expect(verdict).toMatchObject({ decision: "rejected", reasons: ["sexual"] });
    // Aynı anda en fazla 4 istek: ilk kare reddedilince kalanlar başlatılmaz
    expect(image.seen.length).toBeLessThanOrEqual(4);
  });

  it("sağlayıcı hatası bir kez yeniden denenir; yine olmazsa flagged", async () => {
    let calls = 0;
    const flaky = imageModerator(() => (++calls === 1 ? new Error("timeout") : {}));
    expect((await evaluateListing(snapshot({ photoUrls: [], readyVideos: [{ thumbnailUrl: THUMB, durationSeconds: 1 }] }), { image: flaky, text: null })).decision).toBe("safe");

    const broken = imageModerator(() => new Error("down"));
    expect(await evaluateListing(snapshot(), { image: broken, text: null })).toMatchObject({
      decision: "flagged",
      reasons: ["unavailable"],
    });
  });
});

describe("moderateListing", () => {
  it("safe: onaylanır, yayına girer, kayıt yazılır", async () => {
    const { store, events, recorded } = fakeStore(snapshot());
    const result = await moderateListing(VEHICLE, { store, providers: { image: imageModerator(), text: null } });
    expect(result).toEqual({ status: "decided", decision: "safe", reasons: [], published: true });
    expect(events).toEqual(["approve:null"]);
    expect(recorded).toEqual([
      expect.objectContaining({ subjectType: "listing", subjectId: VEHICLE, userId: SELLER, verdict: expect.objectContaining({ decision: "safe" }) }),
    ]);
  });

  it("şiddet %60 üstü: reddedilir ve medya silinir", async () => {
    const { store, events } = fakeStore(snapshot());
    const image = imageModerator((url) => (url === PHOTO ? { violence: 0.81 } : {}));
    const result = await moderateListing(VEHICLE, { store, providers: { image, text: null } });
    expect(result).toMatchObject({ status: "decided", decision: "rejected", reasons: ["violence"], published: false });
    expect(events).toEqual(["reject:violence", "purge"]);
    expect(store.approve).not.toHaveBeenCalled();
  });

  it("şüpheli (%40–60): beklemede kalır, neden yazılır, medya silinmez", async () => {
    const { store, events } = fakeStore(snapshot());
    const image = imageModerator((url) => (url === PHOTO ? { gore: 0.5 } : {}));
    const result = await moderateListing(VEHICLE, { store, providers: { image, text: null } });
    expect(result).toMatchObject({ decision: "flagged", published: false });
    expect(events).toEqual(["hold:review:gore"]);
  });

  it("temizlik hatası kararı geri almaz", async () => {
    const { store } = fakeStore(snapshot());
    vi.mocked(store.purgeMedia).mockRejectedValueOnce(new Error("cloudflare down"));
    const image = imageModerator(() => ({ weapon: 0.9 }));
    await expect(moderateListing(VEHICLE, { store, providers: { image, text: null } })).resolves.toMatchObject({
      decision: "rejected",
    });
    expect(store.record).toHaveBeenCalled();
  });

  it("karar verilmiş ya da olmayan ilanda hiçbir şey yapılmaz (webhook tekrarı)", async () => {
    const decided = fakeStore(snapshot({ moderationStatus: "approved", status: "active" }));
    const image = imageModerator();
    expect(await moderateListing(VEHICLE, { store: decided.store, providers: { image, text: null } })).toEqual({
      status: "skipped",
      reason: "already_decided",
    });
    expect(image.seen).toEqual([]);
    expect(decided.events).toEqual([]);

    const missing = fakeStore(null);
    expect(await moderateListing(VEHICLE, { store: missing.store, providers: { image, text: null } })).toEqual({
      status: "skipped",
      reason: "not_found",
    });
  });
});

describe("decideListingManually", () => {
  it("onay: yayına alır, kararı yöneticiyle kaydeder", async () => {
    const { store, events, recorded } = fakeStore(snapshot({ moderationReason: "review:gore" }));
    expect(await decideListingManually(store, VEHICLE, "approve", ADMIN)).toEqual({ ok: true, published: true });
    expect(events).toEqual(["approve:manual"]);
    expect(recorded[0]).toMatchObject({ moderatorId: ADMIN, verdict: { decision: "safe", provider: "manual" } });
  });

  it("ret: reddeder ve medyayı siler", async () => {
    const { store, events } = fakeStore(snapshot());
    expect(await decideListingManually(store, VEHICLE, "reject", ADMIN)).toEqual({ ok: true, published: false });
    expect(events).toEqual(["reject:manual", "purge"]);
  });

  it("karar verilmiş ilan ya da olmayan ilan", async () => {
    expect(await decideListingManually(fakeStore(snapshot({ moderationStatus: "rejected" })).store, VEHICLE, "approve", ADMIN)).toEqual({
      ok: false,
      code: "already_decided",
    });
    expect(await decideListingManually(fakeStore(null).store, VEHICLE, "approve", ADMIN)).toEqual({
      ok: false,
      code: "vehicle_not_found",
    });
  });
});

describe("toListingSnapshot", () => {
  it("yalnızca işlenmiş videolar kare verir; silinecekler bütün videolar", () => {
    expect(
      toListingSnapshot({
        id: VEHICLE,
        seller_id: SELLER,
        status: "pending_moderation",
        moderation_status: "pending",
        moderation_reason: null,
        description: null,
        city: "Ankara",
        images: [{ image_url: PHOTO }, { image_url: null }],
        videos: [
          { stream_uid: "a", status: "ready", hls_url: "https://h", thumbnail_url: THUMB, duration_seconds: 12 },
          { stream_uid: "b", status: "pending", hls_url: null, thumbnail_url: null, duration_seconds: null },
        ],
      }),
    ).toMatchObject({
      photoUrls: [PHOTO],
      readyVideos: [{ thumbnailUrl: THUMB, durationSeconds: 12 }],
      streamUids: ["a", "b"],
    });
  });
});

// ---------------------------------------------------------------
// Supabase deposu: yazdığı sorgular
// ---------------------------------------------------------------

type Result = { data: unknown; error: unknown };

function fakeSupabase(results: Record<string, Result[]>, storageFiles: string[] = []) {
  const calls: { table: string; steps: unknown[][] }[] = [];
  const removed: string[][] = [];
  const from = (table: string) => {
    const call = { table, steps: [] as unknown[][] };
    calls.push(call);
    const builder: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, property: string) {
          if (property === "then") {
            const result = results[table]?.shift() ?? { data: null, error: new Error(`beklenmeyen sorgu: ${table}`) };
            return (resolve: (value: Result) => void) => resolve(result);
          }
          return (...args: unknown[]) => {
            call.steps.push([property, ...args]);
            return builder;
          };
        },
      },
    );
    return builder;
  };
  const storage = {
    from: (bucket: string) => ({
      list: async (folder: string) => ({ data: storageFiles.map((name) => ({ name, folder, bucket })), error: null }),
      remove: async (paths: string[]) => {
        removed.push(paths);
        return { data: [], error: null };
      },
    }),
  };
  return { supabase: { from, storage } as unknown as SupabaseClient, calls, removed };
}

const NOW = new Date("2026-09-28T10:00:00Z");

describe("createListingModerationStore", () => {
  it("approve: karar ve yayın tek güncellemede, yalnızca denetimdeki ilan", async () => {
    const { supabase, calls } = fakeSupabase({ vehicles: [{ data: [{ id: VEHICLE }], error: null }] });
    const store = createListingModerationStore(supabase, { now: () => NOW });
    expect(await store.approve(VEHICLE, null)).toEqual({ published: true });
    expect(calls).toEqual([
      {
        table: "vehicles",
        steps: [
          ["update", { moderation_status: "approved", moderation_reason: null, moderated_at: NOW.toISOString(), status: "active" }],
          ["eq", "id", VEHICLE],
          ["eq", "status", "pending_moderation"],
          ["eq", "moderation_status", "pending"],
          ["select", "id"],
        ],
      },
    ]);
  });

  it("approve: arşive alınmış ilanda yalnızca karar yazılır", async () => {
    const { supabase, calls } = fakeSupabase({
      vehicles: [
        { data: [], error: null },
        { data: null, error: null },
      ],
    });
    const store = createListingModerationStore(supabase, { now: () => NOW });
    expect(await store.approve(VEHICLE, "manual")).toEqual({ published: false });
    expect(calls[1].steps).toEqual([
      ["update", { moderation_status: "approved", moderation_reason: "manual", moderated_at: NOW.toISOString() }],
      ["eq", "id", VEHICLE],
      ["eq", "moderation_status", "pending"],
    ]);
  });

  it("reject: ilan ve denetim 'rejected'", async () => {
    const { supabase, calls } = fakeSupabase({ vehicles: [{ data: null, error: null }] });
    await createListingModerationStore(supabase, { now: () => NOW }).reject(VEHICLE, "sexual");
    expect(calls[0].steps[0]).toEqual([
      "update",
      { status: "rejected", moderation_status: "rejected", moderation_reason: "sexual", moderated_at: NOW.toISOString() },
    ]);
  });

  it("purgeMedia: Cloudflare videoları, video kayıtları, klasördeki bütün fotoğraflar ve fotoğraf kayıtları", async () => {
    const deleteVideo = vi.fn(async () => {});
    const { supabase, calls, removed } = fakeSupabase(
      { videos: [{ data: null, error: null }], vehicle_images: [{ data: null, error: null }] },
      ["0.jpeg", "7.png"],
    );
    await createListingModerationStore(supabase, { deleteVideo }).purgeMedia(snapshot({ streamUids: ["a", "b"] }));
    expect(deleteVideo.mock.calls).toEqual([["a"], ["b"]]);
    expect(removed).toEqual([[`${VEHICLE}/0.jpeg`, `${VEHICLE}/7.png`]]);
    expect(calls).toEqual([
      { table: "videos", steps: [["delete"], ["eq", "vehicle_id", VEHICLE]] },
      { table: "vehicle_images", steps: [["delete"], ["eq", "vehicle_id", VEHICLE]] },
    ]);
  });

  it("purgeMedia: bir Cloudflare silmesi düşse de gerisi silinir ve hata bildirilir", async () => {
    const deleteVideo = vi.fn(async (uid: string) => {
      if (uid === "a") throw new Error("503");
    });
    const { supabase, calls } = fakeSupabase({
      videos: [{ data: null, error: null }],
      vehicle_images: [{ data: null, error: null }],
    });
    await expect(
      createListingModerationStore(supabase, { deleteVideo }).purgeMedia(snapshot({ streamUids: ["a", "b"] })),
    ).rejects.toThrow("Silinemeyenler: a");
    expect(deleteVideo).toHaveBeenCalledTimes(2);
    expect(calls.map((c) => c.table)).toEqual(["videos", "vehicle_images"]);
  });
});
