import { describe, expect, it } from "vitest";
import {
  RESERVED_USERNAMES,
  USERNAME_PATTERN,
  isReservedUsername,
  localUsernameStatus,
  normalizeUsername,
  profilePath,
  sanitizeUsernameInput,
  suggestUsername,
} from "./username";

describe("sanitizeUsernameInput", () => {
  it.each([
    ["@Kamil", "kamil"],
    ["Şahin Güçlü", "sahin_guclu"],
    ["IŞIK", "isik"],
    ["İstanbul-34", "istanbul_34"],
    ["kâmil.c!", "kamilc"],
    ["araba  sevdalisi", "araba_sevdalisi"],
    ["a".repeat(30), "a".repeat(20)],
    ["😀oto", "oto"],
  ])("%j → %j", (input, expected) => {
    expect(sanitizeUsernameInput(input)).toBe(expected);
  });

  it("çıktı her zaman izin verilen karakterlerden oluşur", () => {
    for (const input of ["Ğ ü Ş ı İ ö ç", "--__--", "ÂÎÛ âîû", "tab\there"]) {
      expect(sanitizeUsernameInput(input)).toMatch(/^[a-z0-9_]{0,20}$/);
    }
  });
});

describe("localUsernameStatus", () => {
  it.each([
    ["kamil", null],
    ["k_1", null],
    ["ab", "invalid"],
    ["a".repeat(21), "invalid"],
    ["Kamil", "invalid"],
    ["kamil.c", "invalid"],
    ["sell", "reserved"],
    ["vitrin", "reserved"],
    ["gozuyle_resmi", "reserved"],
    ["admin2", "reserved"],
    ["kamil_admin", null],
  ] as const)("%s → %s", (name, status) => {
    expect(localUsernameStatus(name)).toBe(status);
  });
});

describe("rezerve liste", () => {
  it("istenen sistem sözcüklerinin hepsini içerir", () => {
    for (const word of ["admin", "api", "sell", "search", "messages", "login", "auth", "terms", "privacy", "vitrin", "explore", "feed"]) {
      expect(isReservedUsername(word)).toBe(true);
    }
  });

  it("uygulamanın üst düzey sayfaları da rezerve", () => {
    for (const route of ["account", "favorites", "vehicles", "search", "sell", "messages", "admin", "auth", "privacy", "terms"]) {
      expect(RESERVED_USERNAMES).toContain(route);
    }
  });

  it("alfabetik, tekrarsız ve kurala uygun biçimde", () => {
    expect([...RESERVED_USERNAMES]).toEqual([...RESERVED_USERNAMES].sort());
    expect(new Set(RESERVED_USERNAMES).size).toBe(RESERVED_USERNAMES.length);
    for (const word of RESERVED_USERNAMES) expect(word).toMatch(USERNAME_PATTERN);
  });
});

describe("suggestUsername", () => {
  it("görünen addan öneri üretir", () => {
    expect(suggestUsername("Kamil Cafersoy", "x@y.com")).toBe("kamil_cafersoy");
    expect(suggestUsername("Şükrü Öztürk", null)).toBe("sukru_ozturk");
  });

  it("ad uygun değilse e-postanın başını kullanır", () => {
    expect(suggestUsername("", "kamil.c@gmail.com")).toBe("kamil_c");
    expect(suggestUsername("Al", "oto.galeri@x.com")).toBe("oto_galeri");
  });

  it("kurala uyan öneri yoksa boş döner", () => {
    expect(suggestUsername("Admin", "sell@x.com")).toBe("");
    expect(suggestUsername(null, "ab@x.com")).toBe("");
  });
});

describe("normalizeUsername / profilePath", () => {
  it("boşluk kırpılır, küçük harfe çevrilir", () => {
    expect(normalizeUsername("  Kamil ")).toBe("kamil");
  });

  it("profil adresi /@ad", () => {
    expect(profilePath("kamil")).toBe("/@kamil");
  });
});
