import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import {
  COMMENT_MAX_LENGTH,
  appendComments,
  cleanComment,
  commentAuthorName,
  commentError,
  deleteComment,
  fetchComments,
  formatCommentTime,
  isCommentBlockReason,
  parseCommentCursor,
  postComment,
  prependComment,
  replaceComment,
  toVehicleComment,
  type DisplayComment,
} from "./comments";
import { COMMENT_POLICY_ERROR } from "./text-moderation";

const VEHICLE = "11111111-1111-4111-8111-111111111111";
const COMMENT = "22222222-2222-4222-8222-222222222222";

const comment = (id: string, overrides: Partial<DisplayComment> = {}): DisplayComment => ({
  id,
  userId: "u1",
  content: `yorum ${id}`,
  createdAt: "2026-09-28T10:00:00Z",
  username: "alici",
  displayName: null,
  avatarUrl: null,
  isSeller: false,
  isMine: false,
  canDelete: false,
  ...overrides,
});

describe("metin", () => {
  it("kırpılır; satır sonları tekleşir, en fazla iki boş satır", () => {
    expect(cleanComment("  Merhaba\r\n\r\n\r\n\r\nnasılsınız?  ")).toBe("Merhaba\n\nnasılsınız?");
  });

  it("boş, uzun ya da kurala aykırı yorum gönderilmez; 500 karakter geçer", () => {
    expect(commentError("   ")).toBe("Yorum boş olamaz.");
    expect(commentError("a".repeat(COMMENT_MAX_LENGTH + 1))).toBe("Yorum en fazla 500 karakter olabilir.");
    expect(commentError(` ${"a".repeat(COMMENT_MAX_LENGTH)} `)).toBeNull();
    expect(commentError("s1kt1r git")).toBe(COMMENT_POLICY_ERROR);
    expect(commentError("Sıkıntısız mı? Değişen var mı?")).toBeNull();
  });
});

describe("formatCommentTime", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  it.each([
    ["2026-09-28T11:59:30Z", "az önce"],
    ["2026-09-28T11:55:00Z", "5 dk önce"],
    ["2026-09-28T09:00:00Z", "3 sa önce"],
    ["2026-09-26T11:00:00Z", "2 g önce"],
    ["2026-09-07T12:00:00Z", "3 hf önce"],
    ["2026-07-01T12:00:00Z", "1 Tem"],
    ["2025-12-30T12:00:00Z", "30 Ara 2025"],
    ["bozuk", "az önce"],
  ])("%s → %s", (iso, label) => {
    expect(formatCommentTime(iso, now)).toBe(label);
  });
});

describe("imleç ve dönüşüm", () => {
  it("ikisi de yoksa ilk sayfa; biri eksik ya da bozuksa geçersiz", () => {
    expect(parseCommentCursor(null, null)).toBeNull();
    expect(parseCommentCursor("2026-09-28T10:00:00.123456+00:00", COMMENT)).toEqual({
      before: "2026-09-28T10:00:00.123456+00:00",
      beforeId: COMMENT,
    });
    expect(parseCommentCursor("2026-09-28T10:00:00Z", null)).toBe("invalid");
    expect(parseCommentCursor("dün", COMMENT)).toBe("invalid");
    expect(parseCommentCursor("2026-09-28T10:00:00Z", "abc")).toBe("invalid");
  });

  it("veritabanı satırı → yorum; ad: @kullanıcı_adı, yoksa ad", () => {
    const c = toVehicleComment({
      id: COMMENT,
      user_id: "u1",
      content: "Merhaba",
      created_at: "2026-09-28T10:00:00Z",
      username: "satici",
      display_name: "Satıcı Bey",
      avatar_url: "https://x/a.webp",
      is_seller: true,
      is_mine: false,
      can_delete: true,
    });
    expect(c).toMatchObject({ username: "satici", isSeller: true, canDelete: true, isMine: false });
    expect(commentAuthorName(c)).toBe("@satici");
    expect(commentAuthorName({ username: null, displayName: "Ayşe" })).toBe("Ayşe");
    expect(commentAuthorName({ username: null, displayName: null })).toBe("Kullanıcı");
    expect(toVehicleComment({ id: "x", user_id: "u", content: "c", created_at: "t" })).toMatchObject({
      username: null,
      isSeller: false,
      canDelete: false,
    });
  });

  it("neden kodları", () => {
    expect(isCommentBlockReason("username_required")).toBe(true);
    expect(isCommentBlockReason("toString")).toBe(false);
    expect(isCommentBlockReason(null)).toBe(false);
  });
});

describe("iyimser liste", () => {
  it("yeni yorum en üste; yerel yorum sunucununkiyle değişir; sayfalar tekrarsız eklenir", () => {
    const list = [comment("a"), comment("b")];
    const withLocal = prependComment(list, comment("local-1", { pending: "sending" }));
    expect(withLocal.map((c) => c.id)).toEqual(["local-1", "a", "b"]);
    const replaced = replaceComment(withLocal, "local-1", comment("c"));
    expect(replaced.map((c) => [c.id, c.pending])).toEqual([
      ["c", undefined],
      ["a", undefined],
      ["b", undefined],
    ]);
    expect(appendComments(replaced, [comment("b"), comment("d")]).map((c) => c.id)).toEqual(["c", "a", "b", "d"]);
    expect(prependComment([comment("a")], comment("a")).map((c) => c.id)).toEqual(["a"]);
  });
});

describe("API çağrıları", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("sayfa: limit ve imleç sorgu dizesinde, oturum varsa taşıyıcı token; önbelleksiz", async () => {
    const fetchImpl = vi.fn(async () => json({ total: 0, comments: [], nextCursor: null }));
    await fetchComments(
      VEHICLE,
      { cursor: { before: "2026-09-28T10:00:00.1+00:00", beforeId: COMMENT }, accessToken: "tok", limit: 20 },
      fetchImpl,
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url, "https://gozuyle.com");
    expect(parsed.pathname).toBe(`/api/vehicles/${VEHICLE}/comments`);
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ limit: "20", before: "2026-09-28T10:00:00.1+00:00", beforeId: COMMENT });
    expect(init).toMatchObject({ method: "GET", cache: "no-store", headers: { Authorization: "Bearer tok" } });

    await fetchComments(VEHICLE, {}, fetchImpl);
    expect((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].headers).toEqual({});
  });

  it("gönderme ve silme; hata kodu ve mesajı; ağ hatasında durum 0", async () => {
    const created = comment(COMMENT, { isMine: true, canDelete: true });
    const ok = vi.fn(async () => json({ comment: created }, 201));
    expect(await postComment(VEHICLE, "Merhaba", "tok", ok)).toEqual({ ok: true, comment: created });
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/vehicles/${VEHICLE}/comments`);
    expect(init).toMatchObject({ method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" } });
    expect(JSON.parse(init.body as string)).toEqual({ content: "Merhaba" });

    const limited = vi.fn(async () => json({ error: { code: "rate_limited", message: "Bekle." } }, 429));
    expect(await postComment(VEHICLE, "x", "tok", limited)).toEqual({ ok: false, status: 429, code: "rate_limited", message: "Bekle." });

    const removed = vi.fn(async () => json({ ok: true }));
    expect(await deleteComment(VEHICLE, COMMENT, "tok", removed)).toEqual({ ok: true });
    expect((removed.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe(`/api/vehicles/${VEHICLE}/comments/${COMMENT}`);

    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await deleteComment(VEHICLE, COMMENT, "tok", offline)).toMatchObject({ ok: false, status: 0 });
  });
});
