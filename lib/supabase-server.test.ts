import { beforeEach, describe, expect, it, vi } from "vitest";

// Oturum doğrulama (lib/supabase-server.ts): Authorization başlığındaki token.

vi.mock("server-only", () => ({}));

const getClaims = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getClaims } }) }));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

const { bearerToken, getAuthenticatedUser, getAuthenticatedUserId } = await import("./supabase-server");

const withToken = (token?: string) =>
  new Request("https://gozuyle.com/api/x", token ? { headers: { Authorization: `Bearer ${token}` } } : {});

beforeEach(() => {
  getClaims.mockReset();
});

describe("getAuthenticatedUser", () => {
  it("geçerli oturum: id ve küçük harfli e-posta", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1", role: "authenticated", email: " Kamil@Ornek.com " } }, error: null });
    expect(await getAuthenticatedUser(withToken("tok"))).toEqual({ id: "u1", email: "kamil@ornek.com" });
    expect(await getAuthenticatedUserId(withToken("tok"))).toBe("u1");
    expect(getClaims).toHaveBeenCalledWith("tok");
  });

  it("e-postasız token: e-posta null", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1", role: "authenticated" } }, error: null });
    expect(await getAuthenticatedUser(withToken("tok"))).toEqual({ id: "u1", email: null });
  });

  it("token yok, geçersiz, anonim ya da anon rolü: oturum yok", async () => {
    expect(await getAuthenticatedUser(withToken())).toBeNull();
    expect(getClaims).not.toHaveBeenCalled();

    getClaims.mockResolvedValueOnce({ data: null, error: new Error("invalid JWT") });
    expect(await getAuthenticatedUser(withToken("tok"))).toBeNull();
    getClaims.mockResolvedValueOnce({ data: { claims: { sub: "u1", role: "authenticated", is_anonymous: true } }, error: null });
    expect(await getAuthenticatedUser(withToken("tok"))).toBeNull();
    getClaims.mockResolvedValueOnce({ data: { claims: { sub: "u1", role: "anon" } }, error: null });
    expect(await getAuthenticatedUser(withToken("tok"))).toBeNull();
  });

  it("bozuk biçimli token'da getClaims fırlatırsa 500 değil, oturum yok (401)", async () => {
    getClaims.mockRejectedValue(new Error("Invalid UTF-8 sequence"));
    expect(await getAuthenticatedUser(withToken("abc.def.ghi"))).toBeNull();
    expect(await getAuthenticatedUserId(withToken("abc.def.ghi"))).toBeNull();
  });
});

describe("bearerToken", () => {
  it("yalnızca 'Bearer <token>' biçimi", () => {
    expect(bearerToken(withToken("abc"))).toBe("abc");
    expect(bearerToken(new Request("https://x", { headers: { Authorization: "Basic abc" } }))).toBeNull();
    expect(bearerToken(new Request("https://x", { headers: { Authorization: "bearer   xyz" } }))).toBe("xyz");
  });
});
