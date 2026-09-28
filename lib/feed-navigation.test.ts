import { describe, expect, it } from "vitest";
import { DESKTOP_MEDIA_QUERY, clampFeedIndex, feedKeyStep, feedKeyStepFor } from "./feed-navigation";

// Dikey akışta klavyeyle ilan ilan gezinme ve masaüstü düzeninin eşiği.

const key = (overrides: Partial<Parameters<typeof feedKeyStepFor>[0]> = {}) => ({
  key: "ArrowDown",
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  defaultPrevented: false,
  target: null,
  ...overrides,
});

/** Yalnızca closest'i olan sahte öğe: seçiciye göre eşleşme verir */
const element = (matches: string[], editable = false) =>
  ({
    isContentEditable: editable,
    closest: (selector: string) => (matches.some((m) => selector.includes(m)) ? {} : null),
  }) as unknown as EventTarget;

describe("eşik", () => {
  it("masaüstü düzeni 1024 px'ten (lg) başlar", () => {
    expect(DESKTOP_MEDIA_QUERY).toBe("(min-width: 64rem)");
  });
});

describe("feedKeyStep / feedKeyStepFor", () => {
  it("↓ ve PageDown sonraki, ↑ ve PageUp önceki; diğer tuşlar gezinmez", () => {
    expect(["ArrowDown", "PageDown", "ArrowUp", "PageUp", "ArrowLeft", " ", "j", "Enter"].map(feedKeyStep)).toEqual([
      1, 1, -1, -1, 0, 0, 0, 0,
    ]);
  });

  it("değiştirici tuş, açık pencere ya da önceden işlenmiş olay: gezinmez", () => {
    expect(feedKeyStepFor(key(), false)).toBe(1);
    for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey", "defaultPrevented"] as const) {
      expect(feedKeyStepFor(key({ [modifier]: true }), false)).toBe(0);
    }
    expect(feedKeyStepFor(key(), true)).toBe(0);
  });

  it("yazı alanında (yorum kutusu, arama) tuşlar onlarındır", () => {
    expect(feedKeyStepFor(key({ target: element(["textarea"]) }), false)).toBe(0);
    expect(feedKeyStepFor(key({ target: element([], true) }), false)).toBe(0);
    // Akıştaki bir düğmeye odaklıyken (ör. videoya tıklandıktan sonra) gezinir
    expect(feedKeyStepFor(key({ key: "ArrowUp", target: element(["button"]) }), false)).toBe(-1);
  });
});

describe("clampFeedIndex", () => {
  it("listenin sınırında durur", () => {
    expect(clampFeedIndex(-1, 5)).toBe(0);
    expect(clampFeedIndex(3, 5)).toBe(3);
    expect(clampFeedIndex(6, 5)).toBe(5);
    expect(clampFeedIndex(1, -1)).toBe(0);
  });
});
