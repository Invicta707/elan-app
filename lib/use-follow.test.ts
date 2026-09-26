import { beforeEach, describe, expect, it, vi } from "vitest";

// Ağ çağrıları ve profil deposu taklit edilir; depo mantığı (iyimser takip,
// geri alma, tohumlama) gerçek
vi.mock("./supabase", () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: "viewer" } } } })) } },
}));
vi.mock("./use-my-profile", () => ({ adjustMyFollowingCount: vi.fn() }));
vi.mock("./follows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./follows")>();
  return { ...actual, followUser: vi.fn(), unfollowUser: vi.fn(), fetchSellerProfiles: vi.fn() };
});

import { fetchSellerProfiles, followUser, unfollowUser } from "./follows";
import { getFollowEntry, primeSellerProfiles, seedFollowState, setFollowing } from "./use-follow";
import { adjustMyFollowingCount } from "./use-my-profile";

const follow = vi.mocked(followUser);
const unfollow = vi.mocked(unfollowUser);
const fetchSellers = vi.mocked(fetchSellerProfiles);
const adjust = vi.mocked(adjustMyFollowingCount);

let seq = 0;
const target = () => `seller-${++seq}`;

beforeEach(() => {
  follow.mockReset().mockResolvedValue();
  unfollow.mockReset().mockResolvedValue();
  fetchSellers.mockReset();
  adjust.mockReset();
});

describe("setFollowing", () => {
  it("iyimser: istek sürerken durum ve takipçi sayısı değişmiş olur", async () => {
    const id = target();
    seedFollowState("viewer", id, false, 10);
    let resolve!: () => void;
    follow.mockReturnValue(new Promise<void>((r) => (resolve = r)));

    const pending = setFollowing("viewer", id, true);
    expect(getFollowEntry("viewer", id)).toMatchObject({ following: true, followers: 11, pending: true });
    expect(adjust).toHaveBeenCalledWith(1);

    resolve();
    expect(await pending).toBeNull();
    expect(getFollowEntry("viewer", id)).toMatchObject({ following: true, followers: 11, pending: false });
    expect(follow).toHaveBeenCalledWith("viewer", id);
  });

  it("sunucu reddederse geri alınır ve Türkçe mesaj döner", async () => {
    const id = target();
    seedFollowState("viewer", id, false, 3);
    follow.mockRejectedValue({ code: "42501", message: "new row violates row-level security policy" });

    expect(await setFollowing("viewer", id, true)).toBe("Bu kullanıcıyı takip edemezsin.");
    expect(getFollowEntry("viewer", id)).toMatchObject({ following: false, followers: 3, pending: false });
    expect(adjust.mock.calls).toEqual([[1], [-1]]);
  });

  it("takibi bırakma sayıyı düşürür; hız sınırı mesajı veritabanından gelir", async () => {
    const id = target();
    seedFollowState("viewer", id, true, 1);
    expect(await setFollowing("viewer", id, false)).toBeNull();
    expect(getFollowEntry("viewer", id)).toMatchObject({ following: false, followers: 0 });
    expect(unfollow).toHaveBeenCalledWith("viewer", id);

    follow.mockRejectedValue({ code: "23514", message: "Çok hızlı takip ediyorsun; biraz bekleyip tekrar dene." });
    expect(await setFollowing("viewer", id, true)).toBe("Çok hızlı takip ediyorsun; biraz bekleyip tekrar dene.");
  });

  it("istek sürerken ikinci dokunuş yok sayılır; kendini takip etmez", async () => {
    const id = target();
    follow.mockReturnValue(new Promise<void>(() => {}));
    void setFollowing("viewer", id, true);
    expect(await setFollowing("viewer", id, false)).toBeNull();
    expect(unfollow).not.toHaveBeenCalled();

    expect(await setFollowing("viewer", "viewer", true)).toBeNull();
    expect(follow).toHaveBeenCalledTimes(1);
  });
});

describe("seedFollowState", () => {
  it("kullanıcının bu oturumda değiştirdiği durumu eski sunucu verisi ezmez", async () => {
    const id = target();
    seedFollowState("viewer", id, false, 5);
    await setFollowing("viewer", id, true);
    seedFollowState("viewer", id, false, 5);
    expect(getFollowEntry("viewer", id)).toMatchObject({ following: true, followers: 6 });
  });

  it("başka kullanıcıya geçilince depo sıfırlanır", () => {
    const id = target();
    seedFollowState("viewer", id, true, 2);
    seedFollowState("other-viewer", "x", false);
    expect(getFollowEntry("viewer", id)).toBeUndefined();
    expect(getFollowEntry("other-viewer", id)).toBeUndefined();
    seedFollowState("viewer", id, true, 2);
  });
});

describe("primeSellerProfiles", () => {
  it("bilinmeyen satıcıları tek istekte ister, takip durumunu tohumlar, tekrar sormaz", async () => {
    const a = target();
    const b = target();
    fetchSellers.mockResolvedValue([{ id: a, username: "kamil", displayName: null, avatarUrl: null, isFollowing: true }]);

    await primeSellerProfiles([a, b, a, null]);
    expect(fetchSellers).toHaveBeenCalledTimes(1);
    expect([...fetchSellers.mock.calls[0][0]].sort()).toEqual([a, b].sort());
    expect(getFollowEntry("viewer", a)).toMatchObject({ following: true });

    await primeSellerProfiles([a, b]);
    expect(fetchSellers).toHaveBeenCalledTimes(1);
  });
});
