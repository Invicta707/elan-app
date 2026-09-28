import { describe, expect, it } from "vitest";
import {
  DESKTOP_MEDIA_QUERY,
  WHEEL_GESTURE_GAP_MS,
  WHEEL_STEP_COOLDOWN_MS,
  clampFeedIndex,
  createWheelStepper,
  feedKeyStep,
  feedKeyStepFor,
} from "./feed-navigation";

// Masaüstü akışında klavye ve fare tekerleğiyle ilan ilan gezinme.

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

  it("yazı alanında (yorum kutusu, arama) ve yan panelde tuşlar onlarındır", () => {
    expect(feedKeyStepFor(key({ target: element(["textarea"]) }), false)).toBe(0);
    expect(feedKeyStepFor(key({ target: element([], true) }), false)).toBe(0);
    expect(feedKeyStepFor(key({ target: element(["data-feed-keys"]) }), false)).toBe(0);
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

describe("createWheelStepper (bir hareket = bir ilan)", () => {
  it("tekerleğin hızlı çevrilmesi ve dokunmatik yüzeyin ivmeli kuyruğu tek adım", () => {
    const step = createWheelStepper();
    const steps = [0, 16, 32, 48, 64, 400, 416].map((t, i) => step(0, [40, 120, 90, 30, 8, 6, 3][i], t));
    expect(steps.filter(Boolean)).toEqual([1]);
  });

  it("aralıklı yeni hareket yeni adım; yön deltaY'den", () => {
    const step = createWheelStepper();
    expect(step(0, 100, 0)).toBe(1);
    expect(step(0, -100, WHEEL_STEP_COOLDOWN_MS + WHEEL_GESTURE_GAP_MS)).toBe(-1);
  });

  it("adımdan hemen sonra (kaydırma sürerken) yeni hareket sayılmaz", () => {
    const step = createWheelStepper();
    expect(step(0, 100, 0)).toBe(1);
    expect(step(0, 100, WHEEL_GESTURE_GAP_MS + 10)).toBe(0);
  });

  it("yatay ve çok küçük kaydırma yok sayılır; hareketin ilk belirgin olayı adım atar", () => {
    const step = createWheelStepper();
    expect(step(80, 20, 0)).toBe(0);
    expect(step(0, 2, 1000)).toBe(0);
    expect(step(0, 50, 1010)).toBe(1);
  });
});
