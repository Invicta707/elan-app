import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

// "server-only" paketi Next dışında içe aktarılınca hata fırlatır
vi.mock("server-only", () => ({}));

import { markVideoReadyAndActivateVehicle } from "./video-activation";

type Result = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

// Supabase sorgu zincirinin sahtesi: her çağrıyı kaydeder, await edilince
// tabloya verilen yanıtı döner.
function fakeClient(responses: Record<string, Result>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        then: (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(responses[table]).then(resolve, reject),
      };
      for (const method of ["update", "eq", "in", "select", "maybeSingle"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const input = {
  streamUid: "stream-1",
  hlsUrl: "https://video/stream-1.m3u8",
  thumbnailUrl: "https://video/stream-1.jpg",
  durationSeconds: 42,
};

describe("markVideoReadyAndActivateVehicle", () => {
  it("videoyu ready yapar ve ilanı sadece draft/pending_video iken active'e alır", async () => {
    const { client, calls } = fakeClient({
      videos: { data: { vehicle_id: "veh-1" }, error: null },
      vehicles: { data: [{ id: "veh-1" }], error: null },
    });

    const result = await markVideoReadyAndActivateVehicle(client, input);

    expect(result).toEqual({ ok: true, vehicleId: "veh-1", vehicleActivated: true });
    expect(calls).toContainEqual({
      table: "videos",
      method: "update",
      args: [{ status: "ready", hls_url: input.hlsUrl, thumbnail_url: input.thumbnailUrl, duration_seconds: 42 }],
    });
    expect(calls).toContainEqual({ table: "videos", method: "eq", args: ["stream_uid", "stream-1"] });
    expect(calls).toContainEqual({ table: "vehicles", method: "update", args: [{ status: "active" }] });
    expect(calls).toContainEqual({ table: "vehicles", method: "eq", args: ["id", "veh-1"] });
    expect(calls).toContainEqual({ table: "vehicles", method: "in", args: ["status", ["draft", "pending_video"]] });
  });

  it("satılmış/arşivlenmiş ilan yeniden açılmaz (güncellenen satır yok)", async () => {
    const { client } = fakeClient({
      videos: { data: { vehicle_id: "veh-1" }, error: null },
      vehicles: { data: [], error: null },
    });

    await expect(markVideoReadyAndActivateVehicle(client, input)).resolves.toEqual({
      ok: true,
      vehicleId: "veh-1",
      vehicleActivated: false,
    });
  });

  it("kayıtlı olmayan videoda ilana dokunmaz", async () => {
    const { client, calls } = fakeClient({ videos: { data: null, error: null } });

    await expect(markVideoReadyAndActivateVehicle(client, input)).resolves.toEqual({
      ok: false,
      error: "unknown_video",
    });
    expect(calls.some((c) => c.table === "vehicles")).toBe(false);
  });

  it.each(["videos", "vehicles"])("%s tablosunda hata olursa database_error döner", async (failing) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({
      videos:
        failing === "videos"
          ? { data: null, error: { message: "boom" } }
          : { data: { vehicle_id: "veh-1" }, error: null },
      vehicles: { data: null, error: { message: "boom" } },
    });

    await expect(markVideoReadyAndActivateVehicle(client, input)).resolves.toEqual({
      ok: false,
      error: "database_error",
    });
    consoleError.mockRestore();
  });
});
