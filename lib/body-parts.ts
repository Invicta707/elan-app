// Boya / değişen şeması (ekspertiz): aracın 13 dış parçası ve her birinin
// durumu. UI'dan bağımsız; şema components/vehicle/BodyDiagram.tsx'te.
//
// Parça bazlı bilgi vehicles.expertise_summary (jsonb) içinde tutulur:
//   { "parts": { "hood": "painted", "front_bumper": "local_paint", ... } }
// Yalnızca orijinal olmayan parçaları yazmak yeter: listede olmayan parça
// orijinaldir. Bilgi girilmemişse şema yalnızca sayılardan kesin olanı
// gösterir: boyalı ve değişen sayısı 0 ise bütün parçalar orijinal, değilse
// hangi parçanın olduğu bilinmediği için "belirtilmemiş".

export const BODY_PARTS = [
  { key: "front_bumper", label: "Ön tampon" },
  { key: "hood", label: "Kaput" },
  { key: "roof", label: "Tavan" },
  { key: "trunk", label: "Bagaj kapağı" },
  { key: "rear_bumper", label: "Arka tampon" },
  { key: "left_front_fender", label: "Sol ön çamurluk" },
  { key: "left_front_door", label: "Sol ön kapı" },
  { key: "left_rear_door", label: "Sol arka kapı" },
  { key: "left_rear_fender", label: "Sol arka çamurluk" },
  { key: "right_front_fender", label: "Sağ ön çamurluk" },
  { key: "right_front_door", label: "Sağ ön kapı" },
  { key: "right_rear_door", label: "Sağ arka kapı" },
  { key: "right_rear_fender", label: "Sağ arka çamurluk" },
] as const;

export type BodyPartKey = (typeof BODY_PARTS)[number]["key"];
export type BodyPartStatus = "original" | "local_paint" | "painted" | "changed";
/** Şemada gösterilen durum: bilgi yoksa "unknown" */
export type BodyPartState = BodyPartStatus | "unknown";
export type BodyPartMap = Partial<Record<BodyPartKey, BodyPartStatus>>;

export const BODY_PART_STATUSES: readonly BodyPartStatus[] = ["original", "local_paint", "painted", "changed"];

export const BODY_PART_STATE_LABELS: Record<BodyPartState, string> = {
  original: "Orijinal",
  local_paint: "Lokal boyalı",
  painted: "Boyalı",
  changed: "Değişen",
  unknown: "Belirtilmemiş",
};

const PART_KEYS = new Set<string>(BODY_PARTS.map((part) => part.key));
const STATUSES = new Set<string>(BODY_PART_STATUSES);

/**
 * expertise_summary'deki parça listesi. Bilinmeyen parça ya da durum yok
 * sayılır (elle yazılmış bozuk veri şemayı bozmasın). Geçerli hiçbir parça
 * yoksa null: parça bilgisi girilmemiş.
 */
export function parseBodyParts(summary: unknown): BodyPartMap | null {
  if (!summary || typeof summary !== "object") return null;
  const parts = (summary as { parts?: unknown }).parts;
  if (!parts || typeof parts !== "object" || Array.isArray(parts)) return null;
  const map: BodyPartMap = {};
  let found = false;
  for (const [key, value] of Object.entries(parts as Record<string, unknown>)) {
    if (PART_KEYS.has(key) && typeof value === "string" && STATUSES.has(value)) {
      map[key as BodyPartKey] = value as BodyPartStatus;
      found = true;
    }
  }
  return found ? map : null;
}

type Counts = { paintedPartsCount: number; changedPartsCount: number };

/** Her parçanın şemadaki durumu (parça bilgisi varsa ondan, yoksa sayılardan kesin olan) */
export function bodyPartStates(counts: Counts, parts: BodyPartMap | null | undefined): Record<BodyPartKey, BodyPartState> {
  const fallback: BodyPartState =
    parts ? "original" : counts.paintedPartsCount === 0 && counts.changedPartsCount === 0 ? "original" : "unknown";
  return Object.fromEntries(BODY_PARTS.map(({ key }) => [key, parts?.[key] ?? fallback])) as Record<BodyPartKey, BodyPartState>;
}

/** Parça bilgisi yokken sayılar orijinal değilse: şema hangi parça olduğunu bilemez */
export function bodyPartsUnknown(counts: Counts, parts: BodyPartMap | null | undefined): boolean {
  return !parts && (counts.paintedPartsCount > 0 || counts.changedPartsCount > 0);
}

// ---------------------------------------------------------------
// /sell: satıcının seçtiği parçalar
// ---------------------------------------------------------------

/** Parçanın durumunu değiştirir; orijinal seçilince listeden çıkar (listede yalnızca orijinal olmayanlar) */
export function setBodyPart(parts: BodyPartMap, key: BodyPartKey, status: BodyPartStatus): BodyPartMap {
  const next: BodyPartMap = { ...parts };
  if (status === "original") delete next[key];
  else next[key] = status;
  return next;
}

/** Boyalı (lokal + tam) ve değişen parça sayısı: ilanın painted/changed_parts_count'u (veritabanı da aynı hesabı yapar) */
export function bodyPartCounts(parts: BodyPartMap): { paintedPartsCount: number; changedPartsCount: number } {
  let paintedPartsCount = 0;
  let changedPartsCount = 0;
  for (const status of Object.values(parts)) {
    if (status === "local_paint" || status === "painted") paintedPartsCount += 1;
    else if (status === "changed") changedPartsCount += 1;
  }
  return { paintedPartsCount, changedPartsCount };
}

/** Seçicinin ve /sell özet kartının tek satırı: "Bütün parçalar orijinal" ya da "2 parça boyalı · Değişensiz" */
export function bodyPartsSummary(parts: BodyPartMap): string {
  const { paintedPartsCount, changedPartsCount } = bodyPartCounts(parts);
  if (paintedPartsCount === 0 && changedPartsCount === 0) return "Bütün parçalar orijinal";
  return [
    paintedPartsCount > 0 ? `${paintedPartsCount} parça boyalı` : "Boyasız",
    changedPartsCount > 0 ? `${changedPartsCount} parça değişen` : "Değişensiz",
  ].join(" · ");
}

/**
 * vehicles.expertise_summary'ye yazılacak nesne: { parts: { ... } }, yalnızca
 * orijinal olmayan parçalar, BODY_PARTS sırasıyla (JSON hep aynı çıksın).
 * Detay çekmecesi parseBodyParts ile aynen okur.
 */
export function expertiseSummary(parts: BodyPartMap): { parts: BodyPartMap } {
  const ordered: BodyPartMap = {};
  for (const { key } of BODY_PARTS) {
    const status = parts[key];
    if (status && status !== "original" && STATUSES.has(status)) ordered[key] = status;
  }
  return { parts: ordered };
}
