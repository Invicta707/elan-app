"use client";

import { RotateCcw, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  EMPTY_CONSOLE_DRAFT,
  MULTI_OPTION,
  consoleDraftFrom,
  filtersEqual,
  filtersFromConsoleDraft,
  type ConsoleDraft,
} from "../../lib/portal";
import {
  EMPTY_FILTERS,
  FUEL_TYPES,
  TRANSMISSIONS,
  TURKISH_CITIES,
  formatAmount,
  type Catalog,
  type SearchFilters,
} from "../../lib/search";
import { FUEL_LABELS, TRANSMISSION_LABELS } from "../../lib/vehicle-labels";

// Masaüstü vitrinin üstündeki yatay filtre konsolu: Marka, Model, Şehir, Vites,
// Yakıt, Fiyat (en az / en çok), Model yılı (en eski / en yeni). Hiçbir alan
// zorunlu değil; tek alan doldurulsa da sonuçlar hemen gelir: seçim kutuları
// seçilir seçilmez, sayı alanları yazmaya ara verilince (TEXT_APPLY_DELAY_MS)
// uygulanır. "İlanları Göster" beklemeden uygular ve sonuçlara kaydırır,
// "Filtreleri Sıfırla" hepsini temizler. Rozet uygulanan filtre sayısıdır.

/** Sayı alanlarında yazmaya bu kadar ara verilince sonuçlar yenilenir */
export const TEXT_APPLY_DELAY_MS = 600;

const onlyDigits = (value: string, max = 12) => value.replace(/\D/g, "").slice(0, max);
const groupDigits = (digits: string) => (digits ? formatAmount(Number(digits)) : "");

const controlClass =
  "h-11 w-full min-w-0 rounded-lg bg-[#121212] px-3 text-[15px] text-white ring-1 ring-inset ring-[#3F3F46] [color-scheme:dark] placeholder:text-[#71717A] transition-shadow hover:ring-[#52525B] disabled:cursor-not-allowed disabled:text-[#71717A] disabled:hover:ring-[#3F3F46] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

export default function FilterConsole({
  catalog,
  catalogFailed,
  filters,
  activeCount,
  onApply,
  onShowResults,
}: {
  /** Marka/model seçenekleri; null: yükleniyor */
  catalog: Catalog | null;
  catalogFailed: boolean;
  /** Adreste uygulanmış filtreler */
  filters: SearchFilters;
  activeCount: number;
  onApply: (next: SearchFilters) => void;
  /** "İlanları Göster": sonuç ızgarasına kaydır */
  onShowResults: () => void;
}) {
  const ids = {
    brand: useId(),
    model: useId(),
    city: useId(),
    transmission: useId(),
    fuel: useId(),
    minPrice: useId(),
    maxPrice: useId(),
    minYear: useId(),
    maxYear: useId(),
    errors: useId(),
  };
  const [draft, setDraft] = useState<ConsoleDraft>(() => consoleDraftFrom(filters));
  const timerRef = useRef<number | null>(null);
  const applyRef = useRef(onApply);
  useEffect(() => {
    applyRef.current = onApply;
  });
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const { filters: draftFilters, errors } = filtersFromConsoleDraft(draft, filters);

  // Filtreler dışarıdan değiştiyse (ör. "Filtreleri temizle", geri gelinen
  // bağlantı) taslak onlardan yeniden kurulur. Konsolun kendi uyguladığı değişiklik
  // taslakla zaten aynıdır: yazılan alan (ve odak) korunur.
  const [syncedFilters, setSyncedFilters] = useState(filters);
  if (!filtersEqual(syncedFilters, filters)) {
    setSyncedFilters(filters);
    if (!filtersEqual(draftFilters, filters)) setDraft(consoleDraftFrom(filters));
  }

  function cancelPending() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function commit(next: ConsoleDraft) {
    cancelPending();
    const { filters: nextFilters } = filtersFromConsoleDraft(next, filters);
    if (!filtersEqual(nextFilters, filters)) applyRef.current(nextFilters);
  }

  /** Seçim kutusu: hemen uygulanır */
  function choose(patch: Partial<ConsoleDraft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    commit(next);
  }

  /** Sayı alanı: yazmaya ara verilince uygulanır */
  function type(patch: Partial<ConsoleDraft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    cancelPending();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const { filters: nextFilters } = filtersFromConsoleDraft(next, filters);
      if (!filtersEqual(nextFilters, filters)) applyRef.current(nextFilters);
    }, TEXT_APPLY_DELAY_MS);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    commit(draft);
    onShowResults();
  }

  function handleReset() {
    setDraft(EMPTY_CONSOLE_DRAFT);
    cancelPending();
    const cleared = { ...EMPTY_FILTERS, sort: filters.sort };
    if (!filtersEqual(cleared, filters)) applyRef.current(cleared);
  }

  const brandModels = useMemo(
    () => (catalog && draft.brandId ? catalog.models.filter((model) => model.brandId === draft.brandId) : []),
    [catalog, draft.brandId],
  );
  // Adresten gelen, 81 ilde olmayan yazım da seçenek olarak kalır
  const cityOptions = draft.city && !TURKISH_CITIES.includes(draft.city) ? [draft.city, ...TURKISH_CITIES] : TURKISH_CITIES;
  const draftDirty = !filtersEqual(draftFilters, filters);
  const errorText = errors.price ?? errors.year;

  return (
    <form
      role="search"
      aria-label="İlan filtreleri"
      onSubmit={handleSubmit}
      className="rounded-2xl bg-[#18181B] p-4 ring-1 ring-inset ring-[#27272A]"
    >
      <div className="grid grid-cols-5 gap-3">
        <Field label="Marka" htmlFor={ids.brand}>
          <select
            id={ids.brand}
            value={draft.brandId}
            disabled={!catalog}
            onChange={(event) => choose({ brandId: event.target.value, modelId: "" })}
            className={controlClass}
          >
            <option value="">{catalog ? "Tüm markalar" : catalogFailed ? "Liste yüklenemedi" : "Yükleniyor…"}</option>
            {catalog?.brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Model" htmlFor={ids.model}>
          <select
            id={ids.model}
            value={draft.modelId}
            disabled={!draft.brandId || !catalog}
            onChange={(event) => choose({ modelId: event.target.value })}
            className={controlClass}
          >
            <option value="">{draft.brandId ? "Tüm modeller" : "Önce marka seç"}</option>
            {brandModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Şehir" htmlFor={ids.city}>
          <select id={ids.city} value={draft.city} onChange={(event) => choose({ city: event.target.value })} className={controlClass}>
            <option value="">Tüm şehirler</option>
            {cityOptions.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Vites" htmlFor={ids.transmission}>
          <select
            id={ids.transmission}
            value={draft.transmission}
            onChange={(event) => choose({ transmission: event.target.value })}
            className={controlClass}
          >
            <option value="">Tümü</option>
            {draft.transmission === MULTI_OPTION && (
              <option value={MULTI_OPTION}>{filters.transmissions.map((value) => TRANSMISSION_LABELS[value]).join(", ")}</option>
            )}
            {TRANSMISSIONS.map((value) => (
              <option key={value} value={value}>
                {TRANSMISSION_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Yakıt" htmlFor={ids.fuel}>
          <select id={ids.fuel} value={draft.fuel} onChange={(event) => choose({ fuel: event.target.value })} className={controlClass}>
            <option value="">Tümü</option>
            {draft.fuel === MULTI_OPTION && (
              <option value={MULTI_OPTION}>{filters.fuelTypes.map((value) => FUEL_LABELS[value]).join(", ")}</option>
            )}
            {FUEL_TYPES.map((value) => (
              <option key={value} value={value}>
                {FUEL_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3">
        <RangeGroup legend="Fiyat (₺)" invalid={Boolean(errors.price)} describedBy={ids.errors}>
          <input
            id={ids.minPrice}
            aria-label="En az fiyat"
            inputMode="numeric"
            autoComplete="off"
            placeholder="En az"
            value={groupDigits(draft.minPrice)}
            onChange={(event) => type({ minPrice: onlyDigits(event.target.value) })}
            aria-invalid={errors.price ? true : undefined}
            className={`${controlClass} tabular-nums`}
          />
          <input
            id={ids.maxPrice}
            aria-label="En çok fiyat"
            inputMode="numeric"
            autoComplete="off"
            placeholder="En çok"
            value={groupDigits(draft.maxPrice)}
            onChange={(event) => type({ maxPrice: onlyDigits(event.target.value) })}
            aria-invalid={errors.price ? true : undefined}
            className={`${controlClass} tabular-nums`}
          />
        </RangeGroup>

        <RangeGroup legend="Model yılı" invalid={Boolean(errors.year)} describedBy={ids.errors}>
          <input
            id={ids.minYear}
            aria-label="En eski model yılı"
            inputMode="numeric"
            autoComplete="off"
            placeholder="En eski"
            value={draft.minYear}
            onChange={(event) => type({ minYear: onlyDigits(event.target.value, 4) })}
            aria-invalid={errors.year ? true : undefined}
            className={`${controlClass} tabular-nums`}
          />
          <input
            id={ids.maxYear}
            aria-label="En yeni model yılı"
            inputMode="numeric"
            autoComplete="off"
            placeholder="En yeni"
            value={draft.maxYear}
            onChange={(event) => type({ maxYear: onlyDigits(event.target.value, 4) })}
            aria-invalid={errors.year ? true : undefined}
            className={`${controlClass} tabular-nums`}
          />
        </RangeGroup>

        <div className="flex items-center gap-2">
          <span aria-live="polite" className="contents">
            {activeCount > 0 && (
              <span
                data-filter-count={activeCount}
                className="inline-flex h-7 items-center rounded-full bg-[#003399]/25 px-2.5 text-[13px] font-semibold whitespace-nowrap text-[#C7D2FE] ring-1 ring-inset ring-[#003399]"
              >
                {activeCount} filtre
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={handleReset}
            disabled={activeCount === 0 && !draftDirty}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-[14.5px] font-semibold whitespace-nowrap text-white ring-1 ring-inset ring-[#3F3F46] transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:text-[#71717A] disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Filtreleri Sıfırla
          </button>
          <button
            type="submit"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#003399] px-4 text-[14.5px] font-semibold whitespace-nowrap text-white transition-colors hover:bg-[#0A3FA8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#18181B]"
          >
            <Search aria-hidden="true" className="h-4 w-4" />
            İlanları Göster
          </button>
        </div>
      </div>

      <p id={ids.errors} role="status" aria-live="polite" className={errorText ? "mt-2 text-[13px] text-[#FCA5A5]" : "sr-only"}>
        {errorText ?? ""}
      </p>
    </form>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-[12.5px] font-medium text-[#A1A1AA]">
        {label}
      </label>
      {children}
    </div>
  );
}

function RangeGroup({
  legend,
  invalid,
  describedBy,
  children,
}: {
  legend: string;
  invalid: boolean;
  describedBy: string;
  children: ReactNode;
}) {
  return (
    <fieldset aria-describedby={invalid ? describedBy : undefined} className="min-w-0">
      <legend className="mb-1.5 text-[12.5px] font-medium text-[#A1A1AA]">{legend}</legend>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </fieldset>
  );
}
