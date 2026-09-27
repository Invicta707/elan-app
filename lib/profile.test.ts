import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

import { checkUsernameAvailability, saveDisplayName, saveUsername } from "./profile";
import { supabase } from "./supabase";

const rpc = vi.mocked(supabase.rpc);
const from = vi.mocked(supabase.from);

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("saveDisplayName", () => {
  it("tabloya doğrudan değil, update_profile_display_name RPC'siyle ve temizlenmiş adla yazar", async () => {
    rpc.mockResolvedValue({ data: "Kamil Oto", error: null } as never);
    expect(await saveDisplayName("  Kamil   Oto ")).toBe("Kamil Oto");
    expect(rpc).toHaveBeenCalledWith("update_profile_display_name", { p_name: "Kamil Oto" });
    // Eski hata: profiles'a {id, display_name, updated_at} upsert'i 42501 alıyordu
    expect(from).not.toHaveBeenCalled();
  });

  it("kurala uymayan ad sunucuya gitmeden reddedilir", async () => {
    await expect(saveDisplayName("K")).rejects.toThrow("En az 2 karakter yaz.");
    await expect(saveDisplayName("<b>Kamil")).rejects.toThrow("Adda < ve > kullanılamaz.");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sunucunun kural mesajı gösterilir; diğer hatalarda genel mesaj", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "Ad 2–30 karakter olmalı; < ve > kullanılamaz." } } as never);
    await expect(saveDisplayName("Kamil")).rejects.toThrow("Ad 2–30 karakter olmalı; < ve > kullanılamaz.");

    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } } as never);
    await expect(saveDisplayName("Kamil")).rejects.toThrow("Ad kaydedilemedi. Biraz sonra tekrar dene.");
  });
});

describe("kullanıcı adı çağrıları", () => {
  it("biçim ve rezerve ağsız; müsaitlik sunucudan", async () => {
    expect(await checkUsernameAvailability("ka")).toBe("invalid");
    expect(await checkUsernameAvailability("sell")).toBe("reserved");
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({ data: "taken", error: null } as never);
    expect(await checkUsernameAvailability(" Kamil ")).toBe("taken");
    expect(rpc).toHaveBeenCalledWith("check_username", { p_username: "kamil" });
  });

  it("saveUsername: veritabanının Türkçe mesajı (alınmış, 7 gün) aynen iletilir", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "Bu kullanıcı adı alınmış." } } as never);
    await expect(saveUsername("kamil")).rejects.toThrow("Bu kullanıcı adı alınmış.");
    rpc.mockResolvedValue({ data: "kamil", error: null } as never);
    await expect(saveUsername(" KAMIL ")).resolves.toBe("kamil");
    expect(rpc).toHaveBeenLastCalledWith("set_username", { p_username: "kamil" });
  });
});
