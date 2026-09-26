import { compareCatalogNames } from "./search";

// Marka/model seçim kutusu (/sell): yazım hatasına dayanıklı arama, adların
// karşılaştırma anahtarı ve serbest girilen adın doğrulaması. UI'dan bağımsız.
//
// catalogKey ve ad kuralları veritabanındakilerle birebir aynıdır
// (supabase/migrations/*_user_catalog_entries.sql: fn_catalog_key,
// fn_clean_catalog_name); lib/catalog-rls.test.ts ikisini karşılaştırır.

export type CatalogOption = { id: string; name: string };

// Aksanlı harflerin karşılıkları (SQL translate() ile aynı sıra ve içerik)
export const CATALOG_FOLD_FROM = "ÇĞİIÖŞÜÂÊÎÔÛËÉÈÄÅÁÀÍÌÓÒÚÙÑŠŽČŘÝçğıöşüâêîôûëéèäåáàíìóòúùñšžčřý";
export const CATALOG_FOLD_TO = "CGIIOSUAEIOUEEEAAAAIIOOUUNSZCRYcgiosuaeioueeeaaaaiioouunszcry";

const FOLD = new Map([...CATALOG_FOLD_FROM].map((ch, i) => [ch, CATALOG_FOLD_TO[i]]));

/**
 * Karşılaştırma anahtarı: büyük/küçük harf, Türkçe ve aksanlı harfler, boşluk
 * ve noktalama önemsiz. "Mercedes-Benz" = "mercedes benz", "Škoda" = "skoda",
 * "C-HR" = "chr". Aynı anahtarlı iki ad aynı kayıttır.
 */
export function catalogKey(name: string): string {
  return [...name]
    .map((ch) => FOLD.get(ch) ?? ch)
    .join("")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Adın kelimeleri (her biri kendi anahtarıyla) */
function wordKeys(name: string): string[] {
  return name
    .split(/[\s\-/.+&']+/)
    .map(catalogKey)
    .filter(Boolean);
}

// ---------------------------------------------------------------
// Serbest girilen ad
// ---------------------------------------------------------------

export const MAX_BRAND_NAME = 40;
export const MAX_MODEL_NAME = 60;

const NAME_CHARS = `A-Za-z0-9${CATALOG_FOLD_FROM}`;
/** SQL'deki desenle aynı: harf/rakamla başlar; boşluk ve . - / + & ' içerebilir */
export const CATALOG_NAME_PATTERN = new RegExp(`^[${NAME_CHARS}][${NAME_CHARS} .\\-/+&']*$`);

/** Baştaki/sondaki boşluk atılır, aradaki boşluklar teke iner */
export function cleanCatalogName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Serbest girilen adın hatası; uygunsa null (boş ad ayrıca "seç ya da yaz" diye karşılanır) */
export function catalogNameError(name: string, maxLength: number): string | null {
  const clean = cleanCatalogName(name);
  if (!clean) return "Bir ad yaz.";
  if (clean.length > maxLength) return `En fazla ${maxLength} karakter olabilir.`;
  if (!CATALOG_NAME_PATTERN.test(clean) || !/[A-Za-z0-9]/.test(clean)) {
    return "Yalnızca harf, rakam, boşluk ve - . / + & ' kullanılabilir.";
  }
  return null;
}

// ---------------------------------------------------------------
// Arama
// ---------------------------------------------------------------

/** Damerau-Levenshtein (bitişik harflerin yer değiştirmesi tek hata sayılır) */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => [i, ...Array<number>(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j += 1) d[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * Seçeneğin sorguyla ne kadar eşleştiği (0: eşleşmedi). Sıra:
 * birebir > adın başı > bir kelimenin başı > seri ("320" → "3 Serisi",
 * "c200" → "C Serisi") > adın içinde > yazım hatası (1–2 harf).
 */
export function matchScore(name: string, query: string): number {
  const q = catalogKey(query);
  if (!q) return 0;
  const key = catalogKey(name);
  if (!key) return 0;

  if (key === q) return 1000;
  if (key.startsWith(q)) return 900 - Math.min(key.length - q.length, 50);

  const words = wordKeys(name);
  const wordIndex = words.findIndex((word) => word.startsWith(q));
  if (wordIndex > 0) return 800 - wordIndex;

  // Seri: adın ilk kelimesi kısa bir kod ("3", "c", "gla") ve sorgu bu kodla
  // başlayıp rakamla devam ediyor ("320", "c200", "gla200")
  const series = words[0];
  if (series && series.length <= 4 && q.length > series.length && q.startsWith(series)) {
    if (/^\d+[a-z]?$/.test(q.slice(series.length))) return 700;
  }

  const position = key.indexOf(q);
  if (position >= 0) return 600 - Math.min(position, 50);

  // Yazım hatası: 4–5 harflik sorguda 1, daha uzunda 2 harfe kadar. Daha kısa
  // sorguda tolerans gürültü üretir ("cro" → "Proace", "cor" → "Corolla")
  if (q.length >= 4) {
    const tolerance = q.length <= 5 ? 1 : 2;
    const distance = Math.min(editDistance(q, key), editDistance(q, key.slice(0, q.length)));
    if (distance <= tolerance) return 500 - distance * 100;
  }
  return 0;
}

/**
 * Sorguya göre sıralı seçenekler. Boş sorguda hepsi, doğal sırayla
 * ("208" < "2008"). Eşit puanlılar da doğal sırayla.
 */
export function searchCatalog(options: readonly CatalogOption[], query: string): CatalogOption[] {
  if (!catalogKey(query)) return [...options].sort((a, b) => compareCatalogNames(a.name, b.name));

  return options
    .map((option) => ({ option, score: matchScore(option.name, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || compareCatalogNames(a.option.name, b.option.name))
    .map((entry) => entry.option);
}

/** Yazılan adla aynı anahtara sahip seçenek (ör. "passat" → "Passat") */
export function findExactOption(options: readonly CatalogOption[], query: string): CatalogOption | undefined {
  const key = catalogKey(query);
  return key ? options.find((option) => catalogKey(option.name) === key) : undefined;
}
