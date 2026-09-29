"use client";

import { Check, RotateCcw } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import {
  BODY_PARTS,
  BODY_PART_STATE_LABELS,
  BODY_PART_STATUSES,
  bodyPartsSummary,
  setBodyPart,
  type BodyPartKey,
  type BodyPartMap,
  type BodyPartStatus,
} from "../../lib/body-parts";
import { CAR_TONES, CarChrome, SHAPES, STATE_COLORS, VIEW_H, VIEW_W, type Rect } from "../vehicle/carBody";

// /sell "Araç Bilgileri": boya / değişen seçici. İlan ayrıntısındaki şemanın
// (components/vehicle/BodyDiagram.tsx) aynı çizimi, düzenlenebilir. Parçaya
// dokununca (ya da klavyeyle Enter / boşluk) seçilir ve şemanın altında dört
// durumlu seçim menüsü açılır: Orijinal (varsayılan), Lokal boyalı, Boyalı,
// Değişen. Boyalı (lokal + tam) ve değişen parça sayısı buradan hesaplanır,
// satıcı ayrıca sayı girmez. Değer yalnızca orijinal olmayan parçaları tutar
// (lib/listing.ts bodyParts → vehicles.expertise_summary.parts).
//
// Dokunma alanları görünen parçadan geniştir: yan paneller dış kenara,
// tamponlar dışa doğru büyür (viewBox kenarında 12 birimlik pay); 390 px
// telefonda en ince parça (yan panel) ~40 px yüksek dokunma alanı alır.

const PAD = 12;

/** Görünen parçadan geniş, birbirine değmeyen dokunma alanı */
function hitRect(key: BodyPartKey, shape: Rect): { x: number; y: number; w: number; h: number } {
  const grow = { x: 2, y: 2 };
  if (key === "rear_bumper") return { x: -PAD, y: shape.y - 4, w: shape.x + shape.w + 2 + PAD, h: shape.h + 8 };
  if (key === "front_bumper") return { x: shape.x - 2, y: shape.y - 4, w: VIEW_W - shape.x + 2 + PAD, h: shape.h + 8 };
  if (key.startsWith("left_")) return { x: shape.x - grow.x, y: -PAD, w: shape.w + grow.x * 2, h: shape.y + shape.h + 3 + PAD };
  if (key.startsWith("right_")) return { x: shape.x - grow.x, y: shape.y - 3, w: shape.w + grow.x * 2, h: VIEW_H - shape.y + 3 + PAD };
  return { x: shape.x - grow.x, y: shape.y - grow.y, w: shape.w + grow.x * 2, h: shape.h + grow.y * 2 };
}

const STATUS_HINTS: Record<BodyPartStatus, string> = {
  original: "Fabrika boyası",
  local_paint: "Bir bölgesi boyalı",
  painted: "Parçanın tamamı",
  changed: "Parça yenilendi",
};

export default function BodyPartsEditor({
  id,
  value,
  onChange,
}: {
  id: string;
  /** Yalnızca orijinal olmayan parçalar */
  value: BodyPartMap;
  onChange: (next: BodyPartMap) => void;
}) {
  const [selected, setSelected] = useState<BodyPartKey | null>(null);
  const pickerId = useId();
  const changedParts = BODY_PARTS.filter(({ key }) => value[key]);
  const selectedPart = selected ? BODY_PARTS.find((part) => part.key === selected) : null;
  const statusOf = (key: BodyPartKey): BodyPartStatus => value[key] ?? "original";

  function choose(status: BodyPartStatus) {
    if (!selected) return;
    onChange(setBodyPart(value, selected, status));
  }

  function onPartKey(event: KeyboardEvent<SVGRectElement>, key: BodyPartKey) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setSelected(key);
  }

  const summary = bodyPartsSummary(value);

  return (
    <div id={id}>
      <svg
        viewBox={`${-PAD} ${-PAD} ${VIEW_W + PAD * 2} ${VIEW_H + PAD * 2}`}
        role="group"
        aria-label="Boya ve değişen seçici: parçaya dokunup durumunu seç"
        className="mx-auto block h-auto w-full max-w-[460px] touch-manipulation select-none"
      >
        <CarChrome tone="light" />
        {BODY_PARTS.map(({ key }) => {
          const shape = SHAPES[key];
          const isSelected = selected === key;
          return (
            <rect
              key={key}
              aria-hidden="true"
              data-part={key}
              data-state={statusOf(key)}
              x={shape.x}
              y={shape.y}
              width={shape.w}
              height={shape.h}
              rx={shape.r}
              fill={STATE_COLORS[statusOf(key)].light}
              stroke={isSelected ? CAR_TONES.light.selected : CAR_TONES.light.edge}
              strokeWidth={isSelected ? 3.5 : 2}
            />
          );
        })}
        {/* Dokunma alanları görünen parçaların üstünde, saydam */}
        {BODY_PARTS.map(({ key, label }) => {
          const hit = hitRect(key, SHAPES[key]);
          return (
            <rect
              key={key}
              data-hit={key}
              x={hit.x}
              y={hit.y}
              width={hit.w}
              height={hit.h}
              fill="transparent"
              role="button"
              tabIndex={0}
              aria-label={`${label}: ${BODY_PART_STATE_LABELS[statusOf(key)]}`}
              aria-pressed={selected === key}
              aria-controls={pickerId}
              className="cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-[#003399]"
              onClick={() => setSelected(key)}
              onKeyDown={(event) => onPartKey(event, key)}
            />
          );
        })}
      </svg>

      {/* Renklerin anlamı (her zaman görünür) */}
      <ul aria-label="Renklerin anlamı" className="mt-2 flex flex-wrap justify-center gap-x-3.5 gap-y-1 text-[12.5px] font-medium text-[#2A2F36]">
        {BODY_PART_STATUSES.map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: STATE_COLORS[status].light }} />
            {BODY_PART_STATE_LABELS[status]}
          </li>
        ))}
      </ul>

      {/* Seçilen parçanın durum menüsü */}
      <div id={pickerId} aria-live="polite">
        {selectedPart ? (
          <div className="mt-3 rounded-xl border border-[#E3E6EA] bg-[#F7F8FA] p-3" data-part-picker={selectedPart.key}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p id={`${pickerId}-title`} className="text-[14.5px] font-semibold text-[#15181C]">
                {selectedPart.label}
              </p>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="h-9 rounded-full px-3 text-[13.5px] font-semibold text-[#003399] hover:bg-[#EAEFF7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
              >
                Tamam
              </button>
            </div>
            <div role="radiogroup" aria-labelledby={`${pickerId}-title`} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {BODY_PART_STATUSES.map((status) => {
                const checked = statusOf(selectedPart.key) === status;
                return (
                  <button
                    key={status}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => choose(status)}
                    className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] ${
                      checked ? "border-[#15181C] bg-white" : "border-[#E3E6EA] bg-white hover:border-[#C9CED6]"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                      style={{ backgroundColor: STATE_COLORS[status].light }}
                    >
                      {checked && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold leading-tight text-[#15181C]">{BODY_PART_STATE_LABELS[status]}</span>
                      <span className="block text-[12px] leading-tight text-[#5B616B]">{STATUS_HINTS[status]}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-center text-[13px] text-[#5B616B]">Boyalı ya da değişen parçaya dokunup durumunu seç.</p>
        )}
      </div>

      {/* Özet: sayılar şemadan hesaplanır; orijinal olmayan parçalar ve sıfırlama */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#EEF0F3] pt-3">
        <p data-body-summary="" className="text-[14px] font-semibold text-[#15181C]">
          {summary}
        </p>
        <button
          type="button"
          onClick={() => {
            onChange({});
            setSelected(null);
          }}
          disabled={changedParts.length === 0}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#C9CED6] bg-white px-3 text-[13.5px] font-semibold text-[#15181C] transition-colors hover:bg-[#F7F8FA] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Tümünü orijinal yap
        </button>
      </div>
      {changedParts.length > 0 && (
        <ul aria-label="Orijinal olmayan parçalar" className="mt-2 flex flex-wrap gap-1.5">
          {changedParts.map(({ key, label }) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => setSelected(key)}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#E3E6EA] bg-white px-2.5 text-[13px] font-medium text-[#15181C] hover:bg-[#F7F8FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
              >
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: STATE_COLORS[statusOf(key)].light }} />
                {label} · {BODY_PART_STATE_LABELS[statusOf(key)]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
