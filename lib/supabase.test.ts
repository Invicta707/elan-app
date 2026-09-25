import { afterEach, describe, expect, it, vi } from "vitest";

// Her testte modül baştan yüklenir: değişkenler modül değerlendirilirken okunur
async function loadWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string);
  return (await import("./supabase")).supabase;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const EMPTY = {
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
};

describe("supabase istemcisi", () => {
  it("değişkenler yokken import hata vermez (build düşmez); ilk kullanımda açık hata verir", async () => {
    const supabase = await loadWithEnv(EMPTY);
    expect(() => supabase.from("brands")).toThrow(/Supabase ortam değişkenleri eksik/);
    expect(() => supabase.auth).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("değişkenler varsa istemci bir kez kurulur ve metotlar çalışır", async () => {
    const supabase = await loadWithEnv({
      ...EMPTY,
      NEXT_PUBLIC_SUPABASE_URL: "https://proje.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-anahtar",
    });
    const query = supabase.from("brands").select("id");
    expect(typeof query.then).toBe("function");
    expect(supabase.auth).toBe(supabase.auth);
  });

  it("boş PUBLISHABLE_KEY tanımsız sayılır, ANON_KEY'e düşülür", async () => {
    const supabase = await loadWithEnv({
      ...EMPTY,
      NEXT_PUBLIC_SUPABASE_URL: "https://proje.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-anahtar",
    });
    expect(() => supabase.from("brands")).not.toThrow();
  });
});
