import { describe, expect, it } from "vitest";
import { formatTurkishPhone, normalizeTurkishPhone, phoneCallHref } from "./phone";

describe("normalizeTurkishPhone", () => {
  it.each([
    ["5445673430", "10 hane, ülke kodsuz"],
    ["05445673430", "11 hane, başında 0"],
    ["905445673430", "zaten 90 ile başlıyor"],
    ["+90 544 567 34 30", "+90 ve boşluklarla"],
    ["0090 544 567 34 30", "00 uluslararası ön ekiyle"],
    ["0544-567-34-30", "tirelerle"],
    ["(544) 567 34 30", "parantezle"],
  ])("%s (%s) → 905445673430", (input) => {
    expect(normalizeTurkishPhone(input)).toBe("905445673430");
  });

  it.each([
    ["", "boş"],
    ["12345", "çok kısa"],
    ["4445673430", "10 hane ama 5 ile başlamıyor"],
    ["9054456734", "10 hane, 90 ile başlıyor"],
    ["90544567343012", "çok uzun"],
    ["abc", "rakam yok"],
  ])("%s (%s) → null", (input) => {
    expect(normalizeTurkishPhone(input)).toBeNull();
  });
});

describe("formatTurkishPhone / phoneCallHref (masaüstü panel: Ara)", () => {
  it("ekranda ulusal biçim, bağlantıda uluslararası", () => {
    for (const input of ["905445673430", "05445673430", "+90 544 567 34 30"]) {
      expect(formatTurkishPhone(input)).toBe("0544 567 34 30");
      expect(phoneCallHref(input)).toBe("tel:+905445673430");
    }
  });

  it("Türkiye numarası değilse null", () => {
    for (const input of ["", "12345", "4445673430"]) {
      expect(formatTurkishPhone(input)).toBeNull();
      expect(phoneCallHref(input)).toBeNull();
    }
  });
});
