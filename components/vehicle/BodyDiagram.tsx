"use client";

import { useState } from "react";
import {
  BODY_PARTS,
  BODY_PART_STATE_LABELS,
  bodyPartStates,
  bodyPartsUnknown,
  type BodyPartKey,
  type BodyPartMap,
  type BodyPartState,
} from "../../lib/body-parts";

// Boya / değişen şeması: aracın üstten görünüşü (burnu sağda; üst kenar sol
// taraf, alt kenar sağ taraf), 13 parça ekspertiz renkleriyle. Parçanın
// üstüne gelince, dokununca ya da klavyeyle odaklanınca parça adı ve durumu
// görünür. Altında renk açıklaması. Masaüstü "İlan detayı" çekmecesi (koyu)
// ve mobil detay penceresi (açık) aynı şemayı çizer.

type Tone = "dark" | "light";
type Rect = { x: number; y: number; w: number; h: number; r: number };

const VIEW_W = 460;
const VIEW_H = 220;
const SIDE_TOP = { y: 16, h: 30 };
const SIDE_BOTTOM = { y: 174, h: 30 };

/** Parçaların yeri (viewBox 460×220) */
const SHAPES: Record<BodyPartKey, Rect> = {
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
export const STATE_COLORS: Record<BodyPartState, Record<Tone, string>> = {
  original: { dark: "#22C55E", light: "#22C55E" },
  local_paint: { dark: "#EAB308", light: "#EAB308" },
  painted: { dark: "#F97316", light: "#F97316" },
  changed: { dark: "#EF4444", light: "#EF4444" },
  unknown: { dark: "#52525B", light: "#C9CED6" },
};

const TONES: Record<Tone, { edge: string; glass: string; wheel: string; tooltip: string; legend: string; note: string }> = {
  dark: {
    edge: "#18181B",
    glass: "#27272A",
    wheel: "#09090B",
    tooltip: "bg-white text-[#121212]",
    legend: "text-[#D4D4D8]",
    note: "text-[#A1A1AA]",
  },
  light: {
    edge: "#FFFFFF",
    glass: "#E4E7EB",
    wheel: "#3F3F46",
    tooltip: "bg-[#15181C] text-white",
    legend: "text-[#2A2F36]",
    note: "text-[#5B6470]",
  },
};

const LEGEND: BodyPartState[] = ["original", "local_paint", "painted", "changed"];

/**
 * İpucu parçanın üstünde, ortasına hizalı; kenara yakın parçada (tamponlar,
 * çamurluklar) şemanın dışına taşmasın diye sola ya da sağa yaslanır
 */
export function tooltipPosition(shape: Rect): { left: string; top: string; transform: string } {
  const center = (shape.x + shape.w / 2) / VIEW_W;
  const x = center < 0.2 ? "0%" : center > 0.8 ? "-100%" : "-50%";
  return {
    left: `${center * 100}%`,
    top: `${(shape.y / VIEW_H) * 100}%`,
    transform: `translate(${x}, calc(-100% - 6px))`,
  };
}

export default function BodyDiagram({
  counts,
  parts,
  tone,
  className = "",
}: {
  counts: { paintedPartsCount: number; changedPartsCount: number };
  /** expertise_summary.parts; yoksa sayılardan kesin olan gösterilir */
  parts: BodyPartMap | null | undefined;
  tone: Tone;
  className?: string;
}) {
  const [active, setActive] = useState<BodyPartKey | null>(null);
  const states = bodyPartStates(counts, parts);
  const unknown = bodyPartsUnknown(counts, parts);
  const t = TONES[tone];
  const activePart = active ? BODY_PARTS.find((part) => part.key === active) : null;
  const activeShape = active ? SHAPES[active] : null;

  return (
    <figure className={className}>
      <div className="relative mx-auto w-full max-w-[380px]" onPointerLeave={(event) => event.pointerType === "mouse" && setActive(null)}>
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="group" aria-label="Boya ve değişen şeması" className="block h-auto w-full select-none">
          {/* Tekerlekler ve camlar: parça değil */}
          {[60, 340].map((x) => (
            <g key={x} aria-hidden="true" fill={t.wheel}>
              <rect x={x} y={4} width={54} height={10} rx={5} />
              <rect x={x} y={206} width={54} height={10} rx={5} />
            </g>
          ))}
          <rect aria-hidden="true" x={116} y={58} width={34} height={104} rx={8} fill={t.glass} />
          <rect aria-hidden="true" x={288} y={58} width={34} height={104} rx={8} fill={t.glass} />

          {BODY_PARTS.map(({ key, label }) => {
            const shape = SHAPES[key];
            const state = states[key];
            const isActive = active === key;
            return (
              <rect
                key={key}
                data-part={key}
                data-state={state}
                x={shape.x}
                y={shape.y}
                width={shape.w}
                height={shape.h}
                rx={shape.r}
                fill={STATE_COLORS[state][tone]}
                stroke={isActive ? (tone === "dark" ? "#FFFFFF" : "#15181C") : t.edge}
                strokeWidth={isActive ? 3 : 2}
                tabIndex={0}
                role="img"
                aria-label={`${label}: ${BODY_PART_STATE_LABELS[state]}`}
                className="cursor-pointer outline-none"
                onPointerEnter={(event) => event.pointerType === "mouse" && setActive(key)}
                onClick={() => setActive((current) => (current === key ? null : key))}
                onFocus={() => setActive(key)}
                onBlur={() => setActive((current) => (current === key ? null : current))}
              />
            );
          })}
        </svg>

        {activePart && activeShape && (
          <p
            role="status"
            data-part-tooltip=""
            className={`pointer-events-none absolute z-10 w-max max-w-[14rem] rounded-md px-2 py-1 text-[12.5px] font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.25)] ${t.tooltip}`}
            style={tooltipPosition(activeShape)}
          >
            {activePart.label} · {BODY_PART_STATE_LABELS[states[activePart.key]]}
          </p>
        )}
      </div>

      <figcaption>
        <ul aria-label="Renklerin anlamı" className={`mt-2.5 flex flex-wrap justify-center gap-x-3.5 gap-y-1 text-[12.5px] font-medium ${t.legend}`}>
          {[...LEGEND, ...(unknown ? (["unknown"] as const) : [])].map((state) => (
            <li key={state} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: STATE_COLORS[state][tone] }} />
              {BODY_PART_STATE_LABELS[state]}
            </li>
          ))}
        </ul>
        {unknown && (
          <p className={`mt-1.5 text-center text-[12.5px] leading-snug ${t.note}`}>
            Satıcı parça bilgisi girmedi: hangi parçaların boyalı ya da değişen olduğu belirtilmemiş.
          </p>
        )}
      </figcaption>
    </figure>
  );
}
