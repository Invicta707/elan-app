"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition, type KeyboardEvent } from "react";
import FavoriteButton from "./FavoriteButton";
import FeedHeader from "./FeedHeader";
import VehicleGridCard from "./VehicleGridCard";
import FilterSheet from "./search/FilterSheet";
import {
  EMPTY_FILTERS,
  SORT_LABELS,
  compareCatalogNames,
  countActiveFilters,
  filtersToSearchParams,
  formatAmount,
  normalizeTr,
  searchVehicles,
  type Catalog,
  type SearchFilters,
  type SortOrder,
  type VehicleSearchResult,
} from "../lib/search";
import { BODY_TYPE_LABELS, FUEL_LABELS, TRANSMISSION_LABELS } from "../lib/vehicle-labels";

type SearchViewProps = {
  catalog: Catalog;
  /** URL'den gelen ve sunucuda ilk sayfası yüklenmiş filtreler */
  filters: SearchFilters;
  initialResults: VehicleSearchResult[];
  initialNextOffset: number;
  initialHasMore: boolean;
  loadFailed: boolean;
  autoFocusSearch: boolean;
};

// Filtreler URL'de tutulur: her değişiklik sunucuda yeni bir ilk sayfa üretir
// (paylaşılabilir link, geri tuşu, yenileme). "Daha fazla göster" ise istemcide
// sonraki sayfaları ekler. page.tsx bu bileşeni filtrelere göre key'lediği için
// filtre değişince liste durumu kendiliğinden sıfırlanır.
export default function SearchView({
  catalog,
  filters,
  initialResults,
  initialNextOffset,
  initialHasMore,
  loadFailed,
  autoFocusSearch,
}: SearchViewProps) {
  const router = useRouter();
  const [isNavigating, startNavigation] = useTransition();

  const [results, setResults] = useState(initialResults);
  const [nextOffset, setNextOffset] = useState(initialNextOffset);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [moreState, setMoreState] = useState<"idle" | "loading" | "error">("idle");
  const [isFilterOpen, setFilterOpen] = useState(false);

  const activeFilterCount = countActiveFilters(filters);

  function applyFilters(next: SearchFilters) {
    const query = filtersToSearchParams(next, catalog).toString();
    startNavigation(() => {
      router.replace(query ? `/search?${query}` : "/search", { scroll: false });
    });
  }

  function retryInitialLoad() {
    startNavigation(() => router.refresh());
  }

  async function loadMore() {
    if (moreState === "loading") return;
    setMoreState("loading");

    try {
      const page = await searchVehicles(filters, nextOffset);
      // Offset sayfalamada araya yeni ilan girerse aynı ilan tekrar gelebilir
      setResults((current) => {
        const seen = new Set(current.map((v) => v.id));
        return [...current, ...page.items.filter((v) => !seen.has(v.id))];
      });
      setNextOffset(page.nextOffset);
      setHasMore(page.hasMore);
      setMoreState("idle");
    } catch (error) {
      console.error("Arama sonuçları yüklenemedi:", error);
      setMoreState("error");
    }
  }

  return (
    <>
      <div className="sticky top-0 z-20 border-b border-[#D9DDE3] bg-[#F2F3F5]/95 backdrop-blur-[6px]">
        <FeedHeader activeTab="search" tone="solid" />

        <div className="mx-auto flex max-w-5xl gap-2 px-4 pb-3">
          <QuickSearch
            catalog={catalog}
            autoFocus={autoFocusSearch}
            onPick={(brandId, modelId) => applyFilters({ ...filters, brandId, modelId })}
          />
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            aria-haspopup="dialog"
            className="relative inline-flex h-11 shrink-0 items-center gap-2 rounded-md border border-[#15181C] bg-white px-3 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
          >
            <SlidersIcon className="h-5 w-5" />
            <span>Filtreler</span>
            {activeFilterCount > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#003399] px-1.5 text-[12px] font-semibold text-white">
                {activeFilterCount}
                <span className="sr-only"> filtre uygulandı</span>
              </span>
            )}
          </button>
        </div>

        <ActiveFilterChips catalog={catalog} filters={filters} onChange={applyFilters} />
      </div>

      <section
        aria-label="Arama sonuçları"
        aria-busy={isNavigating}
        className={`mx-auto max-w-5xl px-4 pt-4 pb-[max(2.5rem,calc(var(--bottom-nav-height)+1.5rem),env(safe-area-inset-bottom))] transition-opacity duration-200 ${
          isNavigating ? "opacity-50" : "opacity-100"
        }`}
      >
        {loadFailed ? (
          <StatusMessage
            title="İlanlar yüklenemedi."
            detail="İnternet bağlantını kontrol edip tekrar dene."
            actionLabel="Tekrar dene"
            onAction={retryInitialLoad}
          />
        ) : results.length === 0 ? (
          activeFilterCount > 0 ? (
            <StatusMessage
              title="Bu filtrelere uyan ilan yok."
              detail="Fiyat aralığını genişletmeyi ya da bir filtreyi kaldırmayı dene."
              actionLabel="Filtreleri temizle"
              onAction={() => applyFilters({ ...EMPTY_FILTERS, sort: filters.sort })}
            />
          ) : (
            <StatusMessage
              title="Şu an yayında ilan yok."
              detail="Satıcılar ilan ekledikçe burada göreceksin."
            />
          )
        ) : (
          <>
            <SortControl
              value={filters.sort}
              disabled={isNavigating}
              onChange={(sort) => applyFilters({ ...filters, sort })}
            />
            <ul className="grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3 lg:grid-cols-4">
              {results.map((vehicle, index) => (
                <li key={vehicle.id}>
                  <VehicleGridCard
                    vehicle={vehicle}
                    eager={index < 4}
                    action={<FavoriteButton vehicleId={vehicle.id} variant="card" />}
                  />
                </li>
              ))}
            </ul>

            {hasMore && (
              <div className="mt-8 flex flex-col items-center gap-3">
                <div role="status" aria-live="polite">
                  {moreState === "error" && (
                    <p className="text-center text-[14px] text-[#B42318]">
                      Daha fazla ilan yüklenemedi. Bağlantını kontrol edip tekrar dene.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={moreState === "loading" || isNavigating}
                  className="h-12 w-full max-w-xs rounded-md bg-[#003399] text-[16px] font-semibold text-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
                >
                  {moreState === "loading"
                    ? "Yükleniyor…"
                    : moreState === "error"
                      ? "Tekrar dene"
                      : "Daha fazla göster"}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {isFilterOpen && (
        <FilterSheet
          catalog={catalog}
          filters={filters}
          onClose={() => setFilterOpen(false)}
          onApply={(next) => {
            setFilterOpen(false);
            applyFilters(next);
          }}
        />
      )}
    </>
  );
}

function SortControl({
  value,
  disabled,
  onChange,
}: {
  value: SortOrder;
  disabled: boolean;
  onChange: (sort: SortOrder) => void;
}) {
  const id = useId();
  return (
    <div className="mb-4 flex items-center justify-end gap-2">
      <label htmlFor={id} className="text-[14px] text-[#5B616B]">
        Sırala
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as SortOrder)}
        className="h-10 rounded-md border border-[#C9CED6] bg-white px-2 text-[14px] font-semibold text-[#15181C] focus-visible:border-[#003399] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]/30"
      >
        {(Object.keys(SORT_LABELS) as SortOrder[]).map((sort) => (
          <option key={sort} value={sort}>
            {SORT_LABELS[sort]}
          </option>
        ))}
      </select>
    </div>
  );
}

function StatusMessage({
  title,
  detail,
  actionLabel,
  onAction,
}: {
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      role="status"
      className="mx-auto flex max-w-sm flex-col items-center gap-4 py-20 text-center"
    >
      <div>
        <p className="text-[18px] font-semibold">{title}</p>
        <p className="mt-1 text-[15px] text-[#5B616B]">{detail}</p>
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="rounded-md border border-[#15181C] bg-white px-5 py-2.5 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Uygulanan filtreler (tek dokunuşla kaldırılabilir)
// ---------------------------------------------------------------

function priceRangeLabel(filters: SearchFilters): string {
  const { minPrice, maxPrice } = filters;
  if (minPrice !== null && maxPrice !== null) {
    return `₺${formatAmount(minPrice)}–₺${formatAmount(maxPrice)}`;
  }
  if (minPrice !== null) return `En az ₺${formatAmount(minPrice)}`;
  return `En çok ₺${formatAmount(maxPrice ?? 0)}`;
}

function yearRangeLabel(filters: SearchFilters): string {
  const { minYear, maxYear } = filters;
  if (minYear !== null && maxYear !== null) {
    return minYear === maxYear ? `${minYear} model` : `${minYear}–${maxYear} model`;
  }
  if (minYear !== null) return `${minYear} ve sonrası`;
  return `${maxYear} ve öncesi`;
}

function ActiveFilterChips({
  catalog,
  filters,
  onChange,
}: {
  catalog: Catalog;
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
}) {
  const brand = catalog.brands.find((b) => b.id === filters.brandId);
  const model = catalog.models.find((m) => m.id === filters.modelId);

  const chips: { key: string; label: string; next: SearchFilters }[] = [];
  if (brand)
    chips.push({
      key: "brand",
      label: brand.name,
      next: { ...filters, brandId: null, modelId: null },
    });
  if (model) chips.push({ key: "model", label: model.name, next: { ...filters, modelId: null } });
  if (filters.minPrice !== null || filters.maxPrice !== null) {
    chips.push({
      key: "price",
      label: priceRangeLabel(filters),
      next: { ...filters, minPrice: null, maxPrice: null },
    });
  }
  if (filters.city)
    chips.push({ key: "city", label: filters.city, next: { ...filters, city: null } });
  if (filters.minYear !== null || filters.maxYear !== null) {
    chips.push({
      key: "year",
      label: yearRangeLabel(filters),
      next: { ...filters, minYear: null, maxYear: null },
    });
  }
  if (filters.maxMileage !== null) {
    chips.push({
      key: "mileage",
      label: `En çok ${formatAmount(filters.maxMileage)} km`,
      next: { ...filters, maxMileage: null },
    });
  }
  if (filters.fuelTypes.length > 0) {
    chips.push({
      key: "fuel",
      label: filters.fuelTypes.map((v) => FUEL_LABELS[v]).join(", "),
      next: { ...filters, fuelTypes: [] },
    });
  }
  if (filters.transmissions.length > 0) {
    chips.push({
      key: "transmission",
      label: filters.transmissions.map((v) => TRANSMISSION_LABELS[v]).join(", "),
      next: { ...filters, transmissions: [] },
    });
  }
  if (filters.bodyTypes.length > 0) {
    chips.push({
      key: "body",
      label: filters.bodyTypes.map((v) => BODY_TYPE_LABELS[v]).join(", "),
      next: { ...filters, bodyTypes: [] },
    });
  }
  if (filters.videoOnly) {
    chips.push({ key: "video", label: "Sadece videolu", next: { ...filters, videoOnly: false } });
  }
  if (filters.hideHeavyDamage) {
    chips.push({
      key: "heavy-damage",
      label: "Ağır hasarsız",
      next: { ...filters, hideHeavyDamage: false },
    });
  }

  if (chips.length === 0) return null;

  return (
    <ul
      aria-label="Uygulanan filtreler"
      className="mx-auto flex max-w-5xl items-center gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {chips.map((chip) => (
        <li key={chip.key} className="shrink-0">
          <button
            type="button"
            onClick={() => onChange(chip.next)}
            aria-label={`${chip.label} filtresini kaldır`}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#15181C] bg-white pl-3 pr-2 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            {chip.label}
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
      {chips.length > 1 && (
        <li className="shrink-0">
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_FILTERS, sort: filters.sort })}
            className="h-8 rounded-sm px-2 text-[13px] font-semibold text-[#003399] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            Tümünü temizle
          </button>
        </li>
      )}
    </ul>
  );
}

// ---------------------------------------------------------------
// Hızlı arama: marka / model önerileri (combobox)
// ---------------------------------------------------------------

type Suggestion = {
  key: string;
  label: string;
  kind: "Marka" | "Model";
  brandId: string;
  modelId: string | null;
  /** Aranan metin (normalize) ve baştan eşleşme için birincil ad */
  haystack: string;
  primary: string;
};

function buildSuggestionIndex(catalog: Catalog): Suggestion[] {
  const brandById = new Map(catalog.brands.map((b) => [b.id, b]));
  const index: Suggestion[] = catalog.brands.map((b) => ({
    key: `b:${b.id}`,
    label: b.name,
    kind: "Marka",
    brandId: b.id,
    modelId: null,
    haystack: normalizeTr(b.name),
    primary: normalizeTr(b.name),
  }));

  for (const m of catalog.models) {
    const brand = brandById.get(m.brandId);
    if (!brand) continue;
    index.push({
      key: `m:${m.id}`,
      label: `${brand.name} ${m.name}`,
      kind: "Model",
      brandId: brand.id,
      modelId: m.id,
      haystack: normalizeTr(`${brand.name} ${m.name}`),
      primary: normalizeTr(m.name),
    });
  }
  return index;
}

function findSuggestions(index: Suggestion[], query: string): Suggestion[] {
  const q = normalizeTr(query);
  if (!q) return [];

  const ranked: { item: Suggestion; rank: number }[] = [];
  for (const item of index) {
    if (!item.haystack.includes(q)) continue;
    const startsWith = item.primary.startsWith(q) || item.haystack.startsWith(q);
    // Baştan eşleşen markalar, sonra baştan eşleşen modeller, sonra içinde geçenler
    const rank = (startsWith ? 0 : 2) + (item.modelId ? 1 : 0);
    ranked.push({ item, rank });
  }

  return ranked
    .sort((a, b) => a.rank - b.rank || compareCatalogNames(a.item.label, b.item.label))
    .slice(0, 8)
    .map((r) => r.item);
}

function QuickSearch({
  catalog,
  autoFocus,
  onPick,
}: {
  catalog: Catalog;
  autoFocus: boolean;
  onPick: (brandId: string, modelId: string | null) => void;
}) {
  const inputId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [isOpen, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const index = useMemo(() => buildSuggestionIndex(catalog), [catalog]);
  const suggestions = useMemo(() => findSuggestions(index, query), [index, query]);
  const showList = isOpen && normalizeTr(query) !== "";
  const activeOption = showList && suggestions[highlight] ? `${listId}-${highlight}` : undefined;

  function pick(suggestion: Suggestion) {
    setQuery("");
    setOpen(false);
    onPick(suggestion.brandId, suggestion.modelId);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(suggestions.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter") {
      const suggestion = suggestions[highlight];
      if (showList && suggestion) {
        event.preventDefault();
        pick(suggestion);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor={inputId} className="sr-only">
        Marka veya model ara
      </label>
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#5B616B]" />
      <input
        id={inputId}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption}
        // Sadece akıştaki hızlı arama butonuyla gelindiğinde odaklanır
        autoFocus={autoFocus}
        autoComplete="off"
        enterKeyHint="search"
        placeholder="Marka veya model ara"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        // text-base (16px): iOS'un odaklanınca sayfayı yakınlaştırmasını önler
        className="h-11 w-full rounded-md border border-[#C9CED6] bg-white pl-10 pr-3 text-base placeholder:text-[#7A808A] focus-visible:border-[#003399] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]/30"
      />

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Marka ve model önerileri"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md border border-[#D9DDE3] bg-white py-1 shadow-[0_8px_24px_rgba(21,24,28,0.14)]"
        >
          {suggestions.length === 0 ? (
            <li
              role="option"
              aria-selected={false}
              aria-disabled="true"
              className="px-3 py-2.5 text-[14px] text-[#5B616B]"
            >
              Eşleşen marka ya da model yok
            </li>
          ) : (
            suggestions.map((suggestion, i) => (
              <li
                key={suggestion.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === highlight}
                // mousedown: input'un blur'u listeyi kapatmadan önce seçimi yakalar
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(suggestion);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2.5 text-[15px] ${
                  i === highlight ? "bg-[#EAEFF7]" : ""
                }`}
              >
                <span className="truncate font-medium">{suggestion.label}</span>
                <span className="shrink-0 text-[12px] text-[#5B616B]">{suggestion.kind}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// İkonlar
// ---------------------------------------------------------------

type IconProps = { className?: string };

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps} className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

function SlidersIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps} className={className} aria-hidden="true">
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps} className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}