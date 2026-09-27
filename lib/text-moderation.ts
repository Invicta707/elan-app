// Temel metin filtresi: küfür, taciz/tehdit, nefret söylemi ve yasa dışı teklifler.
// UI'dan ve sağlayıcılardan bağımsız; hem tarayıcıda (gönderim öncesi uyarı) hem
// sunucuda (ilan denetimi, /api/messages) kullanılır.
//
// Bu kuralın aynısı veritabanında da var (fn_moderation_normalize,
// fn_moderation_terms, fn_moderation_text_category; bkz.
// supabase/migrations/*_content_moderation.sql): mesajlar ve ilan açıklamaları
// istemciyi atlayıp tabloya doğrudan yazılsa bile aynı kurala takılır.
// lib/content-moderation-rls.test.ts iki tarafın aynı sonucu verdiğini sınar;
// listeyi değiştirirsen migration'daki listeyi de değiştir.
//
// Neden kelime listesi (regex değil): Türkçede "ı" → "i" katlanınca "sık",
// "sıkıntı", "canımı sıktı" gibi masum sözcükler küfürle çakışır. Bu yüzden kısa
// kökler yalnızca tam sözcük olarak, uzun ve çakışmayan kökler önek olarak
// aranır. Olumsuzlamaya açık ifadeler ("çalıntı değildir", "change değil")
// listede yok; onları anlamı okuyan sağlayıcı (OpenAI) yakalar.

export type TextCategory = "profanity" | "harassment" | "hate" | "illegal";

export type ModerationTerm = {
  /** normalizeForModeration'dan geçmiş biçim (çift harfler teke inmiş) */
  term: string;
  /** word: tam sözcük(ler); prefix: sözcük başından başlar, son sözcük uzayabilir */
  match: "word" | "prefix";
  category: TextCategory;
};

const words = (category: TextCategory, ...terms: string[]): ModerationTerm[] =>
  terms.map((term) => ({ term, match: "word", category }));
const prefixes = (category: TextCategory, ...terms: string[]): ModerationTerm[] =>
  terms.map((term) => ({ term, match: "prefix", category }));

/** Sıra önemli: ilk eşleşen terimin kategorisi döner (SQL de aynı sırayla bakar). */
export const MODERATION_TERMS: readonly ModerationTerm[] = [
  // Küfür
  ...words("profanity", "amk", "amq", "aq", "yarak", "yaragi", "yaragim", "pic", "pust", "gotune", "gotunu", "fck", "slut"),
  ...words("profanity", "sikerim", "sikeyim", "sikiyim", "sikecem", "sikicem", "sikerler", "sikik"),
  ...prefixes(
    "profanity",
    "amina ko",
    "aminako",
    "amcik",
    "amcig",
    "siktir",
    "siktig",
    "orospu",
    "orosbu",
    "orspu",
    "orusbu",
    "dalyarak",
    "yarak kafa",
    "pezeven",
    "kahpe",
    "kaltak",
    "gavat",
    "yavsak",
    "ibne",
    "serefsiz",
    "gotveren",
    "got veren",
    "gotlek",
    "fuck",
    "motherfuck",
    "bitch",
    "cunt",
    "whore",
    "ashole",
  ),
  // Nefret söylemi
  ...words("hate", "niga", "nigas", "fagot"),
  // Taciz ve tehdit
  ...words("harassment", "oldurecegim", "oldururum", "olduresim"),
  ...prefixes(
    "harassment",
    "seni oldur",
    "gebert",
    "kafani kes",
    "kafani kir",
    "evini yak",
    "kendini oldur",
    "tecavuz",
    "irzina",
    "ciplak foto",
    "ciplak resim",
  ),
  // Yasa dışı teklifler
  ...words("illegal", "esrar", "skunk"),
  ...prefixes(
    "illegal",
    "uyusturucu",
    "kokain",
    "eroin",
    "metamfetamin",
    "bonzai",
    "ekstazi",
    "extasy",
    "ecstasy",
    "captagon",
    "kaptagon",
    "silah sat",
    "satilik silah",
    "ruhsatsiz silah",
    "tabanca sat",
    "satilik tabanca",
    "mermi sat",
    "sahte plaka",
    "sahte ruhsat",
    "sahte belge",
    "sahte ehliyet",
    "sahte kimlik",
    "deneme bonusu",
    "kacak bahis",
    "yasadisi bahis",
    "canli bahis",
  ),
];

// Türkçe harfler ve sık kullanılan simge ikameleri. SQL: translate(...) ile aynı çiftler.
export const FOLD_FROM = "İIıŞşĞğÜüÖöÇçÂâÎîÛû@$";
export const FOLD_TO = "iiissgguuooccaaiiuuas";
// Harf içeren sözcükte rakam → harf (s1kt1r → siktir). Yalnızca rakamdan oluşan
// sözcüklere (yıl, km, fiyat) dokunulmaz.
const LEET_FROM = "0134579";
const LEET_TO = "oieastg";

/**
 * Karşılaştırma için metni sadeleştirir: Türkçe harfler ve aksanlar düz harfe,
 * büyük harf küçüğe, harf/rakam dışı her şey tek boşluğa; sözcük içi rakamlar
 * harfe; ayrı yazılmış tek harfler ("s i k t i r", "a.m.k") birleşir; tekrar
 * eden harfler teke iner ("siiiktir"). Yalnızca ASCII üzerinde çalışır: SQL
 * tarafı yerel ayardan (locale) bağımsız aynı sonucu verir.
 */
export function normalizeForModeration(text: string): string {
  let folded = "";
  for (const ch of text) {
    const index = FOLD_FROM.indexOf(ch);
    folded += index >= 0 ? FOLD_TO[index] : ch;
  }
  const plain = folded
    .replace(/[̀-ͯ]/g, "")
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!plain) return "";

  const out: string[] = [];
  let run = "";
  const flush = () => {
    if (run.length >= 3) out.push(run);
    else out.push(...run);
    run = "";
  };
  for (let token of plain.split(" ")) {
    if (/[a-z]/.test(token)) token = token.replace(/[0134579]/g, (d) => LEET_TO[LEET_FROM.indexOf(d)]);
    if (/^[a-z]$/.test(token)) {
      run += token;
      continue;
    }
    flush();
    out.push(token);
  }
  flush();
  return out.map((token) => token.replace(/(.)\1+/g, "$1")).join(" ");
}

/** Metnin ihlal ettiği ilk kategori; temizse null. */
export function textModerationCategory(text: string | null | undefined): TextCategory | null {
  if (!text) return null;
  const padded = ` ${normalizeForModeration(text)} `;
  if (padded.length <= 2) return null;
  for (const { term, match, category } of MODERATION_TERMS) {
    if (padded.includes(match === "word" ? ` ${term} ` : ` ${term}`)) return category;
  }
  return null;
}

/** Veritabanının mesaj reddinde verdiği metin (fn_messages_text_filter ile birebir aynı) */
export const MESSAGE_POLICY_ERROR = "Mesajın topluluk kurallarına aykırı ifadeler içeriyor. Düzenleyip tekrar gönder.";
/** Veritabanının ilan metni reddinde verdiği metin (fn_guard_vehicle_content ile birebir aynı) */
export const LISTING_TEXT_POLICY_ERROR = "İlan metni topluluk kurallarına aykırı ifadeler içeriyor.";
/** Veritabanının marka/model adı reddinde verdiği metin (fn_catalog_name_filter ile birebir aynı) */
export const CATALOG_NAME_POLICY_ERROR = "Bu marka ya da model adı kullanılamaz.";

/** Formdaki alan hataları: aynı kural, alana özel metin */
export const DESCRIPTION_POLICY_ERROR = "Açıklama topluluk kurallarına aykırı ifadeler içeriyor.";
export const CITY_POLICY_ERROR = "Bu şehir adı kullanılamaz.";

/** Mesaj gönderilmeden önce: kurala takılıyorsa kullanıcıya gösterilecek metin */
export function messagePolicyError(text: string): string | null {
  return textModerationCategory(text) ? MESSAGE_POLICY_ERROR : null;
}
