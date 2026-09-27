import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// "server-only" paketi Next dışında içe aktarılınca hata fırlatır
vi.mock("server-only", () => ({}));

import { markVideoReadyAndQueueModeration } from "./video-activation";

type Result = { data: unknown; error: unknown };

// Supabase sorgu zincirinin sahtesi: her tablo çağrısındaki adımlar kaydedilir,
// await edilince o tablonun sıradaki yanıtı döner.
function fakeClient(results: Record<string, Result[]>) {
  const calls: { table: string; steps: unknown[][] }[] = [];
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
  return { client: { from } as unknown as SupabaseClient, calls };
}

const input = {
  streamUid: "stream-1",
  hlsUrl: "https://video/stream-1.m3u8",
  thumbnailUrl: "https://video/stream-1.jpg",
  durationSeconds: 42,
};

const videoReady = { data: { vehicle_id: "veh-1" }, error: null };
const vehicle = (status: string, moderation_status: string) => ({ data: { status, moderation_status }, error: null });
const ok = { data: null, error: null };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("markVideoReadyAndQueueModeration", () => {
  it("videoyu ready yapar; ilan yayına değil içerik denetimine ('pending_moderation') girer", async () => {
    const { client, calls } = fakeClient({
      videos: [videoReady],
      vehicles: [vehicle("pending_video", "pending"), ok],
    });

    expect(await markVideoReadyAndQueueModeration(client, input)).toEqual({
      ok: true,
      vehicleId: "veh-1",
      moderationQueued: true,
    });
    expect(calls).toEqual([
      {
        table: "videos",
        steps: [
          ["update", { status: "ready", hls_url: input.hlsUrl, thumbnail_url: input.thumbnailUrl, duration_seconds: 42 }],
          ["eq", "stream_uid", "stream-1"],
          ["select", "vehicle_id"],
          ["maybeSingle"],
        ],
      },
      {
        table: "vehicles",
        steps: [["select", "status, moderation_status"], ["eq", "id", "veh-1"], ["maybeSingle"]],
      },
      {
        table: "vehicles",
        steps: [
          ["update", { status: "pending_moderation" }],
          ["eq", "id", "veh-1"],
          ["in", "status", ["draft", "pending_video"]],
        ],
      },
    ]);
    // Hiçbir yolda ilan doğrudan 'active' yapılmaz
    expect(JSON.stringify(calls)).not.toContain('"active"');
  });

  it("video işlenirken arşive alınmış ilan: durum aynı kalır, yine denetlenir", async () => {
    const { client, calls } = fakeClient({ videos: [videoReady], vehicles: [vehicle("archived", "pending")] });
    expect(await markVideoReadyAndQueueModeration(client, input)).toMatchObject({ ok: true, moderationQueued: true });
    expect(calls.filter((c) => c.table === "vehicles")).toHaveLength(1);
  });

  it("onaylanmış yayındaki ilana yeni video: karar sıfırlanır, ilan yeniden denetime girer", async () => {
    const { client, calls } = fakeClient({ videos: [videoReady], vehicles: [vehicle("active", "approved"), ok] });
    expect(await markVideoReadyAndQueueModeration(client, input)).toMatchObject({ ok: true, moderationQueued: true });
    expect(calls.at(-1)).toEqual({
      table: "vehicles",
      steps: [
        [
          "update",
          { moderation_status: "pending", moderation_reason: null, moderated_at: null, status: "pending_moderation" },
        ],
        ["eq", "id", "veh-1"],
        ["eq", "moderation_status", "approved"],
      ],
    });
  });

  it("onaylanmış arşivdeki ilana yeni video: yalnızca karar sıfırlanır", async () => {
    const { client, calls } = fakeClient({ videos: [videoReady], vehicles: [vehicle("archived", "approved"), ok] });
    await markVideoReadyAndQueueModeration(client, input);
    expect(calls.at(-1)?.steps[0]).toEqual([
      "update",
      { moderation_status: "pending", moderation_reason: null, moderated_at: null },
    ]);
  });

  it.each(["sold", "rejected"])("%s ilana dokunulmaz, denetim başlatılmaz", async (status) => {
    const { client, calls } = fakeClient({ videos: [videoReady], vehicles: [vehicle(status, "approved")] });
    expect(await markVideoReadyAndQueueModeration(client, input)).toEqual({
      ok: true,
      vehicleId: "veh-1",
      moderationQueued: false,
    });
    expect(calls.filter((c) => c.table === "vehicles")).toHaveLength(1);
  });

  it("kayıtlı olmayan videoda ilana dokunmaz", async () => {
    const { client, calls } = fakeClient({ videos: [{ data: null, error: null }] });
    expect(await markVideoReadyAndQueueModeration(client, input)).toEqual({ ok: false, error: "unknown_video" });
    expect(calls.some((c) => c.table === "vehicles")).toBe(false);
  });

  it.each([
    ["video güncellemesi", { videos: [{ data: null, error: { message: "boom" } }] }],
    ["ilan okuma", { videos: [videoReady], vehicles: [{ data: null, error: { message: "boom" } }] }],
    ["karantina", { videos: [videoReady], vehicles: [vehicle("pending_video", "pending"), { data: null, error: { message: "boom" } }] }],
  ])("%s hata verirse database_error", async (_label, results) => {
    const { client } = fakeClient(results as Record<string, Result[]>);
    expect(await markVideoReadyAndQueueModeration(client, input)).toEqual({ ok: false, error: "database_error" });
  });
});
