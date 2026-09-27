import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabase: {} }));

const { commentInsertFailure, createVehicleComment, deleteVehicleComment, listVehicleComments } = await import("./comments-server");
const { COMMENT_POLICY_ERROR } = await import("./text-moderation");

const VEHICLE = "11111111-1111-4111-8111-111111111111";
const COMMENT = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const SELLER = "44444444-4444-4444-8444-444444444444";

type Result = { data: unknown; error: unknown };

/** PostgREST zincirinin taklidi: tablo başına adımlar kaydedilir, sonuçlar sırayla verilir */
function fakeClient(results: Record<string, Result[]> = {}, rpcResults: Record<string, Result[]> = {}) {
  const calls: { table: string; steps: unknown[][] }[] = [];
  const rpcCalls: [string, unknown][] = [];
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
  const rpc = vi.fn(async (name: string, args: unknown) => {
    rpcCalls.push([name, args]);
    return rpcResults[name]?.shift() ?? { data: null, error: new Error(`beklenmeyen rpc: ${name}`) };
  });
  return { client: { from, rpc } as unknown as SupabaseClient, calls, rpcCalls };
}

const row = (id: string, created: string, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: USER,
  content: `yorum ${id}`,
  created_at: created,
  username: "alici",
  display_name: null,
  avatar_url: null,
  is_seller: false,
  is_mine: false,
  can_delete: false,
  ...extra,
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listVehicleComments", () => {
  it("bir fazlasını ister; fazlası varsa son yorumdan imleç", async () => {
    const rows = [row("c3", "2026-09-28T10:03:00Z"), row("c2", "2026-09-28T10:02:00Z"), row("c1", "2026-09-28T10:01:00Z")];
    const { client, rpcCalls } = fakeClient({}, { list_vehicle_comments: [{ data: { total: 7, comments: rows }, error: null }] });
    const result = await listVehicleComments(client, VEHICLE, { cursor: null, limit: 2 });
    expect(rpcCalls).toEqual([["list_vehicle_comments", { p_vehicle_id: VEHICLE, p_limit: 3, p_before: null, p_before_id: null }]]);
    expect(result).toMatchObject({
      ok: true,
      page: { total: 7, nextCursor: { before: "2026-09-28T10:02:00Z", beforeId: "c2" } },
    });
    expect(result.ok && result.page.comments.map((c) => c.id)).toEqual(["c3", "c2"]);
  });

  it("son sayfa: imleç yok; imleç RPC'ye geçer; sınır 1–40", async () => {
    const { client, rpcCalls } = fakeClient({}, { list_vehicle_comments: [{ data: { total: 1, comments: [row("c1", "t")] }, error: null }] });
    const result = await listVehicleComments(client, VEHICLE, { cursor: { before: "t0", beforeId: COMMENT }, limit: 500 });
    expect(rpcCalls[0][1]).toMatchObject({ p_limit: 41, p_before: "t0", p_before_id: COMMENT });
    expect(result).toMatchObject({ ok: true, page: { nextCursor: null } });
  });

  it("yönetici her yorumu silebilir", async () => {
    const { client } = fakeClient({}, { list_vehicle_comments: [{ data: { total: 1, comments: [row("c1", "t")] }, error: null }] });
    const result = await listVehicleComments(client, VEHICLE, { cursor: null, limit: 20, viewerIsAdmin: true });
    expect(result.ok && result.page.comments[0].canDelete).toBe(true);
  });

  it("ilan görünmüyorsa 404, okuma hatası 500", async () => {
    const { client } = fakeClient({}, {
      list_vehicle_comments: [
        { data: null, error: null },
        { data: null, error: { message: "boom" } },
      ],
    });
    expect(await listVehicleComments(client, VEHICLE, { cursor: null, limit: 20 })).toMatchObject({ ok: false, status: 404 });
    expect(await listVehicleComments(client, VEHICLE, { cursor: null, limit: 20 })).toMatchObject({ ok: false, status: 500 });
  });
});

describe("createVehicleComment", () => {
  const insertedRow = { id: COMMENT, user_id: USER, content: "Hâlâ satılık mı?", created_at: "2026-09-28T10:00:00.1+00:00" };

  function setup(insert: Result = { data: insertedRow, error: null }, rpcResults: Record<string, Result[]> = {}) {
    const user = fakeClient(
      {
        vehicle_comments: [insert],
        profiles: [{ data: { username: "alici", display_name: "Ali", avatar_url: "https://x/a.webp" }, error: null }],
        vehicles: [{ data: { seller_id: SELLER }, error: null }],
      },
      rpcResults,
    );
    const admin = fakeClient({ content_moderation_events: [{ data: null, error: null }] });
    return { user, admin };
  }

  const create = (setupResult: ReturnType<typeof setup>, content: unknown, textModerator = null) =>
    createVehicleComment({
      userClient: setupResult.user.client,
      adminClient: setupResult.admin.client,
      textModerator,
      userId: USER,
      vehicleId: VEHICLE,
      content,
    });

  it("kırpılmış metni kullanıcının oturumuyla yazar; yazarın herkese açık yüzüyle döner", async () => {
    const s = setup();
    const result = await create(s, "  Hâlâ satılık mı?  ");
    expect(s.user.calls[0]).toEqual({
      table: "vehicle_comments",
      steps: [["insert", { vehicle_id: VEHICLE, content: "Hâlâ satılık mı?" }], ["select", "id, user_id, content, created_at"], ["single"]],
    });
    expect(result).toEqual({
      ok: true,
      comment: {
        id: COMMENT,
        userId: USER,
        content: "Hâlâ satılık mı?",
        createdAt: "2026-09-28T10:00:00.1+00:00",
        username: "alici",
        displayName: "Ali",
        avatarUrl: "https://x/a.webp",
        isSeller: false,
        isMine: true,
        canDelete: true,
      },
    });
  });

  it("boş, metin olmayan ya da uzun yorum 400; veritabanına gidilmez", async () => {
    for (const content of ["   ", 42, "a".repeat(501)]) {
      const s = setup();
      expect(await create(s, content)).toMatchObject({ ok: false, status: 400, code: "invalid_content" });
      expect(s.user.calls).toEqual([]);
    }
  });

  it("kurala aykırı metin 422: yazılmaz, yalnızca karar kaydedilir (metin değil)", async () => {
    const s = setup();
    expect(await create(s, "s1kt1r git")).toEqual({ ok: false, status: 422, code: "content_policy", message: COMMENT_POLICY_ERROR });
    expect(s.user.calls).toEqual([]);
    const insert = s.admin.calls[0].steps[0][1] as Record<string, unknown>;
    expect(insert).toMatchObject({ subject_type: "comment", subject_id: VEHICLE, user_id: USER, decision: "rejected", reasons: ["profanity"] });
    expect(JSON.stringify(insert)).not.toContain("s1kt1r");
  });

  it("OpenAI tanımlıysa ona da sorulur; taciz reddedilir", async () => {
    const s = setup();
    const textModerator = { name: "openai", moderate: vi.fn(async () => ({ harassment: 0.93 })) };
    expect(await create(s, "Seni bulurum", textModerator as never)).toMatchObject({ ok: false, status: 422 });
    expect(textModerator.moderate).toHaveBeenCalledWith("Seni bulurum");
  });

  it.each([
    [{ code: "PT429", message: "Bu ilana az önce yorum yazdın; birkaç saniye bekleyip tekrar dene." }, 429, "rate_limited"],
    [{ code: "23514", message: COMMENT_POLICY_ERROR }, 422, "content_policy"],
    [{ code: "23514", message: "new row violates check constraint" }, 400, "invalid_content"],
    [{ code: "23503", message: "fk" }, 404, "listing_unavailable"],
    [{ code: "XX000", message: "boom" }, 500, "database_error"],
  ])("veritabanı hatası %j → %i", async (error, status, code) => {
    const s = setup({ data: null, error });
    expect(await create(s, "Merhaba")).toMatchObject({ ok: false, status, code });
  });

  it("RLS reddi (42501): neden veritabanına sorulur ve uygun mesaja çevrilir", async () => {
    const cases: [string, number][] = [
      ["username_required", 409],
      ["email_unconfirmed", 403],
      ["listing_unavailable", 404],
      ["blocked", 403],
      ["auth_required", 401],
    ];
    for (const [reason, status] of cases) {
      const s = setup({ data: null, error: { code: "42501", message: "rls" } }, { fn_comment_block_reason: [{ data: reason, error: null }] });
      expect(await create(s, "Merhaba")).toMatchObject({ ok: false, status, code: reason });
      expect(s.user.rpcCalls).toEqual([["fn_comment_block_reason", { p_vehicle_id: VEHICLE }]]);
    }
    const unknown = setup({ data: null, error: { code: "42501", message: "rls" } }, { fn_comment_block_reason: [{ data: null, error: null }] });
    expect(await create(unknown, "Merhaba")).toMatchObject({ status: 403, code: "blocked" });
  });

  it("satıcı kendi ilanına yazınca 'Satıcı' etiketi", async () => {
    const s = setup();
    const result = await createVehicleComment({
      userClient: s.user.client,
      adminClient: s.admin.client,
      textModerator: null,
      userId: SELLER,
      vehicleId: VEHICLE,
      content: "Evet",
    });
    expect(result.ok && result.comment.isSeller).toBe(true);
  });
});

describe("commentInsertFailure", () => {
  it("hata yoksa da 500 döner", async () => {
    expect(await commentInsertFailure(fakeClient().client, VEHICLE, null)).toMatchObject({ status: 500 });
  });
});

describe("deleteVehicleComment", () => {
  const stored = (userId: string, vehicleId = VEHICLE) => ({
    data: { id: COMMENT, vehicle_id: vehicleId, user_id: userId, vehicle: { seller_id: SELLER } },
    error: null,
  });

  function run(actorId: string, lookup: Result, { admin = false, deleted = [{ id: COMMENT }] } = {}) {
    const user = fakeClient({ vehicle_comments: [{ data: deleted, error: null }] });
    const service = fakeClient({ vehicle_comments: [lookup, { data: null, error: null }], content_moderation_events: [{ data: null, error: null }] });
    const isAdmin = vi.fn(async () => admin);
    const promise = deleteVehicleComment({
      userClient: user.client,
      adminClient: service.client,
      userId: actorId,
      isAdmin,
      vehicleId: VEHICLE,
      commentId: COMMENT,
    });
    return { promise, user, service, isAdmin };
  }

  it("yazar kendi oturumuyla siler (RLS); yönetici sorulmaz", async () => {
    const { promise, user, isAdmin } = run(USER, stored(USER));
    expect(await promise).toEqual({ ok: true });
    expect(user.calls[0].steps).toEqual([["delete"], ["eq", "id", COMMENT], ["select", "id"]]);
    expect(isAdmin).not.toHaveBeenCalled();
  });

  it("ilan sahibi ilanındaki yorumu siler", async () => {
    const { promise, user } = run(SELLER, stored(USER));
    expect(await promise).toEqual({ ok: true });
    expect(user.calls).toHaveLength(1);
  });

  it("yönetici servis anahtarıyla siler; karar yöneticiyle kaydedilir", async () => {
    const ADMIN = "99999999-9999-4999-8999-999999999999";
    const { promise, user, service } = run(ADMIN, stored(USER), { admin: true });
    expect(await promise).toEqual({ ok: true });
    expect(user.calls).toEqual([]);
    expect(service.calls[1].steps).toEqual([["delete"], ["eq", "id", COMMENT]]);
    expect(service.calls[2].steps[0][1]).toMatchObject({ subject_type: "comment", subject_id: COMMENT, user_id: USER, moderator_id: ADMIN, provider: "manual" });
  });

  it("başkası 403; yorum yoksa ya da başka ilana aitse 404", async () => {
    expect(await run("55555555-5555-4555-8555-555555555555", stored(USER)).promise).toMatchObject({ ok: false, status: 403 });
    expect(await run(USER, { data: null, error: null }).promise).toMatchObject({ ok: false, status: 404 });
    expect(await run(USER, stored(USER, "66666666-6666-4666-8666-666666666666")).promise).toMatchObject({ ok: false, status: 404 });
    // Arada silinmişse (RLS 0 satır)
    expect(await run(USER, stored(USER), { deleted: [] }).promise).toMatchObject({ ok: false, status: 404 });
  });
});
