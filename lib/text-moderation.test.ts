import { describe, expect, it } from "vitest";
import {
  MODERATION_TERMS,
  messagePolicyError,
  MESSAGE_POLICY_ERROR,
  normalizeForModeration,
  textModerationCategory,
} from "./text-moderation";

describe("normalizeForModeration", () => {
  it.each([
    ["Şerefsiz İBNE", "serefsiz ibne"],
    ["SIKINTI yok", "sikinti yok"],
    ["s1kt1r", "siktir"],
    ["s.i.k.t.i.r", "siktir"],
    ["s i k t i r git", "siktir git"],
    ["siiiiktir", "siktir"],
    ["or0$pu", "orospu"],
    ["@mk", "amk"],
    ["ş̧erefsiz", "serefsiz"],
    ["1.6 dizel, 450 bin km, 2015", "1 6 dizel 450 bin km 2015"],
    ["Golf Mk7 GTI", "golf mkt gti"],
    ["a b", "a b"],
    ["   ", ""],
    ["😀 selam 😀", "selam"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeForModeration(input)).toBe(expected);
  });

  it("yalnızca ASCII harfleri küçültür (Kelvin işareti ayraç olur)", () => {
    expect(normalizeForModeration("K")).toBe("");
  });

  it("listedeki her terim zaten sadeleştirilmiş biçimde ve tekrarsız", () => {
    for (const { term } of MODERATION_TERMS) expect(normalizeForModeration(term)).toBe(term);
    const keys = MODERATION_TERMS.map((t) => `${t.match}:${t.term}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("textModerationCategory: yakalananlar", () => {
  it.each([
    ["amk", "profanity"],
    ["AQ ne biçim araba", "profanity"],
    ["a.m.k", "profanity"],
    ["siktir git", "profanity"],
    ["S1KT1R", "profanity"],
    ["s i k t i r", "profanity"],
    ["orrrrospu çocuğu", "profanity"],
    ["amına koyayım", "profanity"],
    ["Şerefsiz herif", "profanity"],
    ["pezevenk", "profanity"],
    ["what the fuck", "profanity"],
    ["seni öldürürüm", "harassment"],
    ["Seni öldüreceğim", "harassment"],
    ["gebertirim seni", "harassment"],
    ["kafanı keserim", "harassment"],
    ["çıplak fotoğraf at", "harassment"],
    ["esrar var mı", "illegal"],
    ["Kokain satılır", "illegal"],
    ["Satılık tabanca", "illegal"],
    ["silah satıyorum", "illegal"],
    ["sahte plaka yapılır", "illegal"],
    ["Deneme bonusu veren siteler", "illegal"],
  ])("%j → %s", (text, category) => {
    expect(textModerationCategory(text)).toBe(category);
  });
});

describe("textModerationCategory: masum Türkçe ve araç ilanı metinleri", () => {
  it.each([
    "Sıkıntısız araç, sık sık bakımı yapıldı",
    "canımı sıktı bu fiyat",
    "sıkı pazarlık yapılır",
    "Öldürecek fiyat!",
    "esrarengiz bir renk",
    "amortisörler yeni, ambalajında",
    "amcamdan aldım",
    "Golf Mk 7, 2015 model 1.6 TDI",
    "Supra MK4",
    "Kia Picanto",
    "Ford Escort",
    "Mitsubishi Pajero",
    "Silahlı Kuvvetlerden emekli sahibinden",
    "çalıntı değildir, change değildir",
    "Şasesi değişmemiş, boyasız",
    "götürürüm istediğin yere",
    "Ibiza, Seat",
    "1.6 dizel, 450 bin km, 2015",
    "",
  ])("%j temiz", (text) => {
    expect(textModerationCategory(text)).toBeNull();
  });

  it("boş ve tanımsız metin temiz", () => {
    expect(textModerationCategory(null)).toBeNull();
    expect(textModerationCategory(undefined)).toBeNull();
  });
});

describe("messagePolicyError", () => {
  it("filtreye takılan mesajda veritabanıyla aynı metni döner", () => {
    expect(messagePolicyError("aq")).toBe(MESSAGE_POLICY_ERROR);
    expect(messagePolicyError("Araç hâlâ satılık mı?")).toBeNull();
  });
});
