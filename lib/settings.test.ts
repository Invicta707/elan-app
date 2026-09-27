import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: { rpc: vi.fn(), auth: { updateUser: vi.fn() } } }));

import {
  DEFAULT_NOTIFICATION_PREFS,
  fetchBlockedUsers,
  readNotificationPrefs,
  saveNotificationPrefs,
  signInMethodLabel,
  toBlockedUser,
} from "./settings";
import { supabase } from "./supabase";

const rpc = vi.mocked(supabase.rpc);
const updateUser = vi.mocked(supabase.auth.updateUser);

beforeEach(() => {
  rpc.mockReset();
  updateUser.mockReset();
});

describe("bildirim tercihleri", () => {
  it("kayıt yoksa ya da bozuksa hepsi açık", () => {
    expect(readNotificationPrefs(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(readNotificationPrefs({ notification_prefs: "evet" })).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(readNotificationPrefs({ notification_prefs: { messages: "no", followers: false } })).toEqual({
      messages: true,
      followers: false,
      followingListings: true,
    });
  });

  it("kullanıcının auth kaydına (user_metadata) yazılır; hata Türkçe", async () => {
    updateUser.mockResolvedValue({ data: {}, error: null } as never);
    const prefs = { messages: false, followers: true, followingListings: false };
    await saveNotificationPrefs(prefs);
    expect(updateUser).toHaveBeenCalledWith({ data: { notification_prefs: prefs } });

    updateUser.mockResolvedValue({ data: {}, error: new Error("network") } as never);
    await expect(saveNotificationPrefs(prefs)).rejects.toThrow("Tercih kaydedilemedi");
  });
});

describe("signInMethodLabel", () => {
  it("Google, e-posta ya da ikisi", () => {
    expect(signInMethodLabel({ app_metadata: { provider: "google", providers: ["google"] } })).toBe("Google");
    expect(signInMethodLabel({ app_metadata: { provider: "email", providers: ["email", "google"] } })).toBe("Google");
    expect(signInMethodLabel({ app_metadata: { provider: "email" } })).toBe("E-posta ve şifre");
    expect(signInMethodLabel({ app_metadata: {} })).toBe("E-posta");
  });
});

describe("engellenen kullanıcılar", () => {
  it("RPC yanıtını dönüştürür; eksik satırları atar", async () => {
    rpc.mockResolvedValue({
      data: [
        { id: "u1", username: "kamil", display_name: "Kamil", avatar_url: null, blocked_at: "2026-09-27T10:00:00Z" },
        { username: "kimliksiz" },
      ],
      error: null,
    } as never);
    expect(await fetchBlockedUsers()).toEqual([
      { id: "u1", username: "kamil", displayName: "Kamil", avatarUrl: null, blockedAt: "2026-09-27T10:00:00Z" },
    ]);
    expect(rpc).toHaveBeenCalledWith("list_blocked_users");
    expect(toBlockedUser(null)).toBeNull();
  });

  it("hata Türkçe mesajla fırlatılır", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } } as never);
    await expect(fetchBlockedUsers()).rejects.toThrow("Engellenen kullanıcılar yüklenemedi.");
  });
});
