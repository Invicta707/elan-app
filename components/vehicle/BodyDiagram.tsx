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
import { CAR_TONES, CarChrome, SHAPES, STATE_COLORS, VIEW_H, VIEW_W, type BodyTone, type Rect } from "./carBody";

// Boya / değişen şeması: aracın üstten görünüşü (burnu sağda; üst kenar sol
// taraf, alt kenar sağ taraf), 13 parça ekspertiz renkleriyle. Parçanın
// üstüne gelince, dokununca ya da klavyeyle odaklanınca parça adı ve durumu
// görünür. Altında renk açıklaması. Masaüstü "İlan detayı" çekmecesi (koyu)
// ve mobil detay penceresi (açık) aynı şemayı çizer.

type Tone = BodyTone;

export { STATE_COLORS };

const TONES: Record<Tone, { edge: string; tooltip: string; legend: string; note: string }> = {
  dark: { edge: CAR_TONES.dark.edge, tooltip: "bg-white text-[#121212]", legend: "text-[#D4D4D8]", note: "text-[#A1A1AA]" },
  light: { edge: CAR_TONES.light.edge, tooltip: "bg-[#15181C] text-white", legend: "text-[#2A2F36]", note: "text-[#5B6470]" },
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
          <CarChrome tone={tone} />

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
                stroke={isActive ? CAR_TONES[tone].selected : t.edge}
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
