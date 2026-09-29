import type { BodyPartKey, BodyPartState } from "../../lib/body-parts";

// Aracın üstten görünüşü (burnu sağda; üst kenar sol taraf, alt kenar sağ
// taraf): 13 parçanın yeri, tekerlekler, camlar ve ekspertiz renkleri. İlan
// ayrıntısındaki salt okunur şema (BodyDiagram) ve /sell'deki seçici
// (components/sell/BodyPartsEditor.tsx) aynı çizimi kullanır.

export type BodyTone = "dark" | "light";
export type Rect = { x: number; y: number; w: number; h: number; r: number };

export const VIEW_W = 460;
export const VIEW_H = 220;
const SIDE_TOP = { y: 16, h: 30 };
const SIDE_BOTTOM = { y: 174, h: 30 };

/** Parçaların yeri (viewBox 460×220) */
export const SHAPES: Record<BodyPartKey, Rect> = {
  rear_bumper: { x: 10, y: 40, w: 26, h: 140, r: 12 },
  trunk: { x: 42, y: 52, w: 70, h: 116, r: 10 },
  roof: { x: 154, y: 54, w: 130, h: 112, r: 10 },
  hood: { x: 326, y: 52, w: 92, h: 116, r: 10 },
  front_bumper: { x: 424, y: 40, w: 26, h: 140, r: 12 },
  left_rear_fender: { x: 40, w: 94, r: 8, ...SIDE_TOP },
  left_rear_door: { x: 138, w: 88, r: 6, ...SIDE_TOP },
  left_front_door: { x: 230, w: 88, r: 6, ...SIDE_TOP },
  left_front_fender: { x: 322, w: 98, r: 8, ...SIDE_TOP },
  right_rear_fender: { x: 40, w: 94, r: 8, ...SIDE_BOTTOM },
  right_rear_door: { x: 138, w: 88, r: 6, ...SIDE_BOTTOM },
  right_front_door: { x: 230, w: 88, r: 6, ...SIDE_BOTTOM },
  right_front_fender: { x: 322, w: 98, r: 8, ...SIDE_BOTTOM },
};

/** Ekspertiz renkleri: orijinal yeşil, lokal boyalı sarı, boyalı turuncu, değişen kırmızı */
export const STATE_COLORS: Record<BodyPartState, Record<BodyTone, string>> = {
  original: { dark: "#22C55E", light: "#22C55E" },
  local_paint: { dark: "#EAB308", light: "#EAB308" },
  painted: { dark: "#F97316", light: "#F97316" },
  changed: { dark: "#EF4444", light: "#EF4444" },
  unknown: { dark: "#52525B", light: "#C9CED6" },
};

export const CAR_TONES: Record<BodyTone, { edge: string; glass: string; wheel: string; selected: string }> = {
  dark: { edge: "#18181B", glass: "#27272A", wheel: "#09090B", selected: "#FFFFFF" },
  light: { edge: "#FFFFFF", glass: "#E4E7EB", wheel: "#3F3F46", selected: "#15181C" },
};

/** Parça olmayan çizim: tekerlekler, arka cam ve ön cam */
export function CarChrome({ tone }: { tone: BodyTone }) {
  const t = CAR_TONES[tone];
  return (
    <g aria-hidden="true">
      {[60, 340].map((x) => (
        <g key={x} fill={t.wheel}>
          <rect x={x} y={4} width={54} height={10} rx={5} />
          <rect x={x} y={206} width={54} height={10} rx={5} />
        </g>
      ))}
      <rect x={116} y={58} width={34} height={104} rx={8} fill={t.glass} />
      <rect x={288} y={58} width={34} height={104} rx={8} fill={t.glass} />
    </g>
  );
}
