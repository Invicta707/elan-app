"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import type { FuelType, TransmissionType } from "../../lib/feed";
import {
  BODY_TYPES,
  EMPTY_FILTERS,
  FUEL_TYPES,
  MIN_SEARCH_YEAR,
  TRANSMISSIONS,
  TURKISH_CITIES,
  formatAmount,
  parsePrice,
  parseYear,
  type BodyType,
  type Catalog,
  type SearchFilters,
  type SortOrder,
} from "../../lib/search";
import { BODY_TYPE_LABELS, FUEL_LABELS, TRANSMISSION_LABELS } from "../../lib/vehicle-labels";

// ---------------------------------------------------------------
// Filtre paneli: mobilde alttan açılan sayfa, masaüstünde ortada pencere.
// Arama sayfası (/search) ve ana sayfanın mobil video akışı (hap düğmesi) kullanır.
// ---------------------------------------------------------------

type Draft = {
  brandId: string;
  modelId: string;
  minPrice: string;
  maxPrice: string;
  city: string;
  videoOnly: boolean;
  minYear: string;
  maxYear: string;
  maxMileage: string;
  fuelTypes: FuelType[];
  transmissions: TransmissionType[];
  bodyTypes: BodyType[];
  hideHeavyDamage: boolean;
};

const numberText = (value: number | null) => (value !== null ? String(value) : "");

function toDraft(filters: SearchFilters): Draft {
  return {
    brandId: filters.brandId ?? "",
    modelId: filters.modelId ?? "",
    minPrice: numberText(filters.minPrice),
    maxPrice: numberText(filters.maxPrice),
    city: filters.city ?? "",
    videoOnly: filters.videoOnly,
    minYear: numberText(filters.minYear),
    maxYear: numberText(filters.maxYear),
    maxMileage: numberText(filters.maxMileage),
    fuelTypes: filters.fuelTypes,
    transmissions: filters.transmissions,
    bodyTypes: filters.bodyTypes,
    hideHeavyDamage: filters.hideHeavyDamage,
  };
}

// Sıralama panelde değil sonuç listesinin üstünde seçilir; panel onu korur
function fromDraft(draft: Draft, sort: SortOrder): SearchFilters {
  return {
    brandId: draft.brandId || null,
    modelId: draft.brandId && draft.modelId ? draft.modelId : null,
    minPrice: parsePrice(draft.minPrice),
    maxPrice: parsePrice(draft.maxPrice),
    city: draft.city.trim() || null,
    videoOnly: draft.videoOnly,
    minYear: parseYear(draft.minYear),
    maxYear: parseYear(draft.maxYear),
    maxMileage: parsePrice(draft.maxMileage),
    fuelTypes: draft.fuelTypes,
    transmissions: draft.transmissions,
    bodyTypes: draft.bodyTypes,
    hideHeavyDamage: draft.hideHeavyDamage,
    sort,
  };
}

/** Seçiliyse çıkarır, değilse ekler; sıra seçeneklerin sırasıyla aynı kalır. */
function toggleIn<T extends string>(list: T[], value: T, order: readonly T[]): T[] {
  const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  return order.filter((option) => next.includes(option));
}

const onlyDigits = (value: string) => value.replace(/\D/g, "").slice(0, 12);
const groupDigits = (digits: string) => (digits ? formatAmount(Number(digits)) : "");

const fieldClass =
  "h-11 w-full rounded-md border border-[#C9CED6] bg-white px-3 text-base text-[#15181C] disabled:bg-[#EEF0F3] disabled:text-[#7A808A] focus-visible:border-[#003399] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]/30";

export default function FilterSheet({
  catalog,
  filters,
  onApply,
  onClose,
  submitLabel = "İlanları göster",
  showVideoOnly = true,
}: {
  catalog: Catalog;
  filters: SearchFilters;
  onApply: (next: SearchFilters) => void;
  onClose: () => void;
  /** Gönder düğmesinin metni (akışta "Videoları göster") */
  submitLabel?: string;
  /** false: "Sadece videolu" anahtarı gizlenir (akış zaten yalnızca videolu ilanları gösterir) */
  showVideoOnly?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const brandId = useId();
  const modelId = useId();
  const minId = useId();
  const maxId = useId();
  const priceErrorId = useId();
  const cityId = useId();
  const cityListId = useId();
  const videoLabelId = useId();
  const minYearId = useId();
  const maxYearId = useId();
  const yearErrorId = useId();
  const mileageId = useId();
  const heavyDamageLabelId = useId();

  // Panel her açılışta yeniden oluşturulur; taslak o anki filtrelerden başlar
  const [draft, setDraft] = useState<Draft>(() => toDraft(filters));

  const brandModels = useMemo(
    () => catalog.models.filter((m) => m.brandId === draft.brandId),
    [catalog.models, draft.brandId],
  );

  const minPrice = parsePrice(draft.minPrice);
  const maxPrice = parsePrice(draft.maxPrice);
  const priceError =
    minPrice !== null && maxPrice !== null && minPrice > maxPrice
      ? "En az fiyat, en çok fiyattan büyük olamaz."
      : null;

  const maxAllowedYear = new Date().getFullYear() + 1;
  const minYear = parseYear(draft.minYear);
  const maxYear = parseYear(draft.maxYear);
  const yearError =
    (draft.minYear && minYear === null) || (draft.maxYear && maxYear === null)
      ? `Yıl ${MIN_SEARCH_YEAR} ile ${maxAllowedYear} arasında olmalı.`
      : minYear !== null && maxYear !== null && minYear > maxYear
        ? "En eski yıl, en yeni yıldan büyük olamaz."
        : null;
  const hasError = Boolean(priceError || yearError);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();

    // Panel açıkken arkadaki sayfa kaymasın
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previousOverflow;
    };
  }, []);

  function close() {
    // close olayı onClose'u tetikler; Esc tuşu da aynı yoldan kapatır
    dialogRef.current?.close();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasError) return;
    onApply(fromDraft(draft, filters.sort));
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      // Panelin dışına (karartılmış alana) dokununca kapanır
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="m-0 mt-auto max-h-[88dvh] w-full max-w-none overflow-hidden rounded-t-2xl bg-white p-0 text-[#15181C] backdrop:bg-black/50 sm:m-auto sm:max-w-md sm:rounded-2xl"
    >
      <form onSubmit={handleSubmit} className="flex max-h-[88dvh] flex-col">
        <div className="flex items-center justify-between border-b border-[#E3E6EA] px-4 py-3">
          <h2 id={titleId} className="text-[22px] font-semibold [font-family:var(--font-display)]">
            Filtreler
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Filtreleri kapat"
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-[#F2F3F5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={brandId} className="mb-1.5 block text-[14px] font-semibold">
                Marka
              </label>
              <select
                id={brandId}
                value={draft.brandId}
                onChange={(event) =>
                  setDraft((d) => ({ ...d, brandId: event.target.value, modelId: "" }))
                }
                className={fieldClass}
              >
                <option value="">Tüm markalar</option>
                {catalog.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={modelId} className="mb-1.5 block text-[14px] font-semibold">
                Model
              </label>
              <select
                id={modelId}
                value={draft.modelId}
                disabled={!draft.brandId}
                onChange={(event) => setDraft((d) => ({ ...d, modelId: event.target.value }))}
                className={fieldClass}
              >
                <option value="">{draft.brandId ? "Tüm modeller" : "Önce marka seç"}</option>
                {brandModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-[14px] font-semibold">Fiyat (₺)</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={minId} className="sr-only">
                  En az fiyat
                </label>
                <input
                  id={minId}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="En az"
                  value={groupDigits(draft.minPrice)}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, minPrice: onlyDigits(event.target.value) }))
                  }
                  aria-invalid={priceError ? true : undefined}
                  aria-describedby={priceError ? priceErrorId : undefined}
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor={maxId} className="sr-only">
                  En çok fiyat
                </label>
                <input
                  id={maxId}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="En çok"
                  value={groupDigits(draft.maxPrice)}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, maxPrice: onlyDigits(event.target.value) }))
                  }
                  aria-invalid={priceError ? true : undefined}
                  aria-describedby={priceError ? priceErrorId : undefined}
                  className={fieldClass}
                />
              </div>
            </div>
            {priceError && (
              <p id={priceErrorId} className="mt-1.5 text-[13px] text-[#B42318]">
                {priceError}
              </p>
            )}
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-[14px] font-semibold">Model yılı</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={minYearId} className="sr-only">
                  En eski yıl
                </label>
                <input
                  id={minYearId}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="En eski"
                  value={draft.minYear}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, minYear: onlyDigits(event.target.value).slice(0, 4) }))
                  }
                  aria-invalid={yearError ? true : undefined}
                  aria-describedby={yearError ? yearErrorId : undefined}
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor={maxYearId} className="sr-only">
                  En yeni yıl
                </label>
                <input
                  id={maxYearId}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="En yeni"
                  value={draft.maxYear}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, maxYear: onlyDigits(event.target.value).slice(0, 4) }))
                  }
                  aria-invalid={yearError ? true : undefined}
                  aria-describedby={yearError ? yearErrorId : undefined}
                  className={fieldClass}
                />
              </div>
            </div>
            {yearError && (
              <p id={yearErrorId} className="mt-1.5 text-[13px] text-[#B42318]">
                {yearError}
              </p>
            )}
          </fieldset>

          <div>
            <label htmlFor={mileageId} className="mb-1.5 block text-[14px] font-semibold">
              En çok kilometre
            </label>
            <input
              id={mileageId}
              inputMode="numeric"
              autoComplete="off"
              placeholder="Örn. 150.000"
              value={groupDigits(draft.maxMileage)}
              onChange={(event) =>
                setDraft((d) => ({ ...d, maxMileage: onlyDigits(event.target.value) }))
              }
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor={cityId} className="mb-1.5 block text-[14px] font-semibold">
              Şehir
            </label>
            <input
              id={cityId}
              list={cityListId}
              autoComplete="off"
              placeholder="Tüm şehirler"
              value={draft.city}
              onChange={(event) => setDraft((d) => ({ ...d, city: event.target.value }))}
              className={fieldClass}
            />
            <datalist id={cityListId}>
              {TURKISH_CITIES.map((city) => (
                <option key={city} value={city} />
              ))}
            </datalist>
          </div>

          <ChipGroup
            legend="Yakıt türü"
            options={FUEL_TYPES}
            labels={FUEL_LABELS}
            selected={draft.fuelTypes}
            onToggle={(value) =>
              setDraft((d) => ({ ...d, fuelTypes: toggleIn(d.fuelTypes, value, FUEL_TYPES) }))
            }
          />

          <ChipGroup
            legend="Vites"
            options={TRANSMISSIONS}
            labels={TRANSMISSION_LABELS}
            selected={draft.transmissions}
            onToggle={(value) =>
              setDraft((d) => ({
                ...d,
                transmissions: toggleIn(d.transmissions, value, TRANSMISSIONS),
              }))
            }
          />

          <ChipGroup
            legend="Kasa tipi"
            options={BODY_TYPES}
            labels={BODY_TYPE_LABELS}
            selected={draft.bodyTypes}
            onToggle={(value) =>
              setDraft((d) => ({ ...d, bodyTypes: toggleIn(d.bodyTypes, value, BODY_TYPES) }))
            }
          />

          {showVideoOnly && (
            <SwitchRow
              labelId={videoLabelId}
              label="Sadece videolu ilanlar"
              checked={draft.videoOnly}
              onToggle={() => setDraft((d) => ({ ...d, videoOnly: !d.videoOnly }))}
            />
          )}

          <SwitchRow
            labelId={heavyDamageLabelId}
            label="Ağır hasar kayıtlıları gizle"
            checked={draft.hideHeavyDamage}
            onToggle={() => setDraft((d) => ({ ...d, hideHeavyDamage: !d.hideHeavyDamage }))}
          />
        </div>

        <div className="flex gap-3 border-t border-[#E3E6EA] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setDraft(toDraft(EMPTY_FILTERS))}
            className="h-12 flex-1 rounded-md border border-[#15181C] bg-white text-[16px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
          >
            Temizle
          </button>
          <button
            type="submit"
            disabled={hasError}
            className="h-12 flex-[2] rounded-md bg-[#003399] text-[16px] font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// Çoklu seçim: hiçbiri seçili değilse filtre uygulanmaz
function ChipGroup<T extends string>({
  legend,
  options,
  labels,
  selected,
  onToggle,
}: {
  legend: string;
  options: readonly T[];
  labels: Record<T, string>;
  selected: T[];
  onToggle: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[14px] font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onToggle(option)}
              className={`h-10 rounded-full border px-4 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2 ${
                isSelected
                  ? "border-[#003399] bg-[#EAEFF7] text-[#003399]"
                  : "border-[#C9CED6] bg-white text-[#15181C]"
              }`}
            >
              {labels[option]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function SwitchRow({
  labelId,
  label,
  checked,
  onToggle,
}: {
  labelId: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span id={labelId} className="text-[15px] font-semibold">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        onClick={onToggle}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2 ${
          checked ? "bg-[#E5484D]" : "bg-[#C9CED6]"
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
