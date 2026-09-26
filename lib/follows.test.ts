import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

import {
  fetchSellerProfiles,
  followErrorMessage,
  followUser,
  parseProfileParam,
  toProfilePageData,
  toSellerProfile,
  unfollowUser,
} from "./follows";
import { supabase } from "./supabase";

const rpc = vi.mocked(supabase.rpc);
const from = vi.mocked(supabase.from);

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("toProfilePageData", () => {
  it("RPC yanıtını sayılar ve bayraklarla dönüştürür", () => {
    expect(
      toProfilePageData({
        id: "u1",
        username: "kamil",
        display_name: "Kamil C.",
        avatar_url: null,
        followers_count: 12,
        following_count: "3",
        listings_count: 2,
        is_me: false,
        is_following: true,
      }),
    ).toEqual({
      id: "u1",
      username: "kamil",
      displayName: "Kamil C.",
      avatarUrl: null,
      followersCount: 12,
      followingCount: 3,
      listingsCount: 2,
      isMe: false,
      isFollowing: true,
    });
  });

  it("bulunamayan kullanıcı (null) ya da eksik yanıt null döner", () => {
    expect(toProfilePageData(null)).toBeNull();
    expect(toProfilePageData({ id: "u1" })).toBeNull();
  });
});

describe("toSellerProfile", () => {
  it("kullanıcı adı olmayan satıcı da döner", () => {
    expect(toSellerProfile({ id: "s1", username: null, display_name: "Ali", avatar_url: "https://x/a.webp", is_following: false })).toEqual({
      id: "s1",
      username: null,
      displayName: "Ali",
      avatarUrl: "https://x/a.webp",
      isFollowing: false,
    });
  });
});

describe("parseProfileParam", () => {
  it.each([
    ["kamil", "kamil"],
    ["Kamil", "kamil"],
    ["%40kamil", "kamil"],
    ["@k_1", "k_1"],
    ["ka", null],
    ["kamil.c", null],
    ["%E0%A4%A", null],
  ])("%s → %s", (param, expected) => {
    expect(parseProfileParam(param)).toBe(expected);
  });
});

describe("followErrorMessage", () => {
  it("veritabanı hatalarını Türkçe metne çevirir", () => {
    expect(followErrorMessage({ code: "23514", message: "En fazla 5000 kişiyi takip edebilirsin." })).toBe(
      "En fazla 5000 kişiyi takip edebilirsin.",
    );
    expect(followErrorMessage({ code: "42501" })).toBe("Bu kullanıcıyı takip edemezsin.");
    expect(followErrorMessage({ code: "23503" })).toBe("Kullanıcı bulunamadı.");
    expect(followErrorMessage(new TypeError("Failed to fetch"))).toContain("Bağlantını kontrol");
  });
});

describe("followUser / unfollowUser", () => {
  it("zaten takip ediliyorsa (23505) başarılı sayılır; diğer hatalar fırlatılır", async () => {
    const insert = vi.fn();
    from.mockReturnValue({ insert } as never);

    insert.mockResolvedValue({ error: { code: "23505" } });
    await expect(followUser("me", "you")).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith("follows");
    expect(insert).toHaveBeenCalledWith({ follower_id: "me", following_id: "you" });

    insert.mockResolvedValue({ error: { code: "42501" } });
    await expect(followUser("me", "you")).rejects.toMatchObject({ code: "42501" });
  });

  it("takibi bırakma yalnızca kendi kaydını siler", async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const del = vi.fn(() => ({ eq: eq1 }));
    from.mockReturnValue({ delete: del } as never);

    await unfollowUser("me", "you");
    expect(eq1).toHaveBeenCalledWith("follower_id", "me");
    expect(eq2).toHaveBeenCalledWith("following_id", "you");
  });
});

describe("fetchSellerProfiles", () => {
  it("tekrarları atar, en fazla 50 kimlik gönderir, boş listede istek atmaz", async () => {
    rpc.mockResolvedValue({ data: [{ id: "a", username: "a_1", display_name: null, avatar_url: null, is_following: false }], error: null } as never);
    const ids = ["a", "a", ...Array.from({ length: 60 }, (_, i) => `id-${i}`)];
    const result = await fetchSellerProfiles(ids);
    expect(result).toHaveLength(1);
    const [name, args] = rpc.mock.calls[0] as unknown as [string, { p_ids: string[] }];
    expect(name).toBe("get_public_profiles");
    expect(args.p_ids).toHaveLength(50);
    expect(new Set(args.p_ids).size).toBe(50);

    rpc.mockClear();
    expect(await fetchSellerProfiles([])).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});
