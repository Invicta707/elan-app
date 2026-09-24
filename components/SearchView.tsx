"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import FeedHeader from "./FeedHeader";
import {
  EMPTY_FILTERS,
  TURKISH_CITIES,
  countActiveFilters,
  currencySpoken,
  currencySymbol,
  filtersToSearchParams,
  formatAmount,
  normalizeTr,
  parsePrice,
  searchVehicles,
  type Catalog,
  type SearchFilters,
  type VehicleSearchResult,
} from "../lib/search";

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
        className={`mx-auto max-w-5xl px-4 pt-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] transition-opacity duration-200 ${
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
              onAction={() => applyFilters(EMPTY_FILTERS)}
            />
          ) : (
            <StatusMessage
              title="Şu an yayında ilan yok."
              detail="Satıcılar ilan ekledikçe burada göreceksin."
            />
          )
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3 lg:grid-cols-4">
              {results.map((vehicle, index) => (
                <li key={vehicle.id}>
                  <ResultCard vehicle={vehicle} eager={index < 4} />
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

// ---------------------------------------------------------------
// Sonuç kartı
// ---------------------------------------------------------------

function ResultCard({ vehicle, eager }: { vehicle: VehicleSearchResult; eager: boolean }) {
  const imageUrl = vehicle.coverImageUrl ?? vehicle.videoThumbnailUrl;
  const title = `${vehicle.brandName} ${vehicle.modelName}`;

  const body = (
    <>
      <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-[#DDE1E6]">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt=""
            fill
            sizes="(min-width: 1024px) 240px, (min-width: 768px) 33vw, 50vw"
            loading={eager ? "eager" : "lazy"}
            className="object-cover"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[13px] text-[#5B616B]">
            Fotoğraf yok
          </span>
        )}

        {vehicle.hasPlayableVideo && <VideoBadge />}

        <SmallPricePlate
          price={vehicle.price}
          currency={vehicle.currency}
          className="absolute bottom-2 left-2"
        />
      </div>

      <h3 className="mt-2 truncate text-[17px] font-semibold leading-tight [font-family:var(--font-display)]">
        {title}
      </h3>
      <p className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-[#4A5058]">
        <span>{vehicle.year}</span>
        <span>{formatAmount(vehicle.mileageKm)} km</span>
      </p>
      {vehicle.city && (
        <p className="mt-0.5 flex items-center gap-1 text-[13px] text-[#4A5058]">
          <PinIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{vehicle.city}</span>
        </p>
      )}
    </>
  );

  // Videolu ilan: dikey akışta bu ilanla başlar (/?v=<id>)
  if (vehicle.hasPlayableVideo) {
    return (
      <Link
        href={`/?v=${vehicle.id}`}
        className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F2F3F5]"
      >
        {body}
        <span className="sr-only">, videoyu akışta izle</span>
      </Link>
    );
  }

  return <article aria-label={title}>{body}</article>;
}

function VideoBadge() {
  return (
    <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-[#E5484D] py-0.5 pl-1.5 pr-2 text-[12px] font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.45),0_0_14px_rgba(229,72,77,0.95)]">
      <PlayIcon className="h-3 w-3" />
      Video
    </span>
  );
}

// Akıştaki fiyat plakasının küçük hâli: soldaki mavi şeritte para birimi
function SmallPricePlate({
  price,
  currency,
  className = "",
}: {
  price: number;
  currency: string;
  className?: string;
}) {
  return (
    <p
      className={`inline-flex h-7 items-stretch overflow-hidden rounded-[4px] border-[1.5px] border-black bg-white text-black shadow-[0_2px_0_rgba(0,0,0,0.35)] ${className}`}
    >
      <span
        aria-hidden="true"
        className="flex w-5 items-center justify-center bg-[#003399] text-[11px] font-semibold text-white"
      >
        {currencySymbol(currency)}
      </span>
      <span className="flex items-center px-1.5 text-[17px] font-extrabold leading-none tabular-nums [font-family:var(--font-display)]">
        {formatAmount(price)}
        <span className="sr-only"> {currencySpoken(currency)}</span>
      </span>
    </p>
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
  if (filters.videoOnly) {
    chips.push({ key: "video", label: "Sadece videolu", next: { ...filters, videoOnly: false } });
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
            onClick={() => onChange(EMPTY_FILTERS)}
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
    .sort((a, b) => a.rank - b.rank || a.item.label.localeCompare(b.item.label, "tr"))
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
// Filtre paneli: mobilde alttan açılan sayfa, masaüstünde ortada pencere
// ---------------------------------------------------------------

type Draft = {
  brandId: string;
  modelId: string;
  minPrice: string;
  maxPrice: string;
  city: string;
  videoOnly: boolean;
};

function toDraft(filters: SearchFilters): Draft {
  return {
    brandId: filters.brandId ?? "",
    modelId: filters.modelId ?? "",
    minPrice: filters.minPrice !== null ? String(filters.minPrice) : "",
    maxPrice: filters.maxPrice !== null ? String(filters.maxPrice) : "",
    city: filters.city ?? "",
    videoOnly: filters.videoOnly,
  };
}

function fromDraft(draft: Draft): SearchFilters {
  return {
    brandId: draft.brandId || null,
    modelId: draft.brandId && draft.modelId ? draft.modelId : null,
    minPrice: parsePrice(draft.minPrice),
    maxPrice: parsePrice(draft.maxPrice),
    city: draft.city.trim() || null,
    videoOnly: draft.videoOnly,
  };
}

const onlyDigits = (value: string) => value.replace(/\D/g, "").slice(0, 12);
const groupDigits = (digits: string) => (digits ? formatAmount(Number(digits)) : "");

const fieldClass =
  "h-11 w-full rounded-md border border-[#C9CED6] bg-white px-3 text-base text-[#15181C] disabled:bg-[#EEF0F3] disabled:text-[#7A808A] focus-visible:border-[#003399] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]/30";

function FilterSheet({
  catalog,
  filters,
  onApply,
  onClose,
}: {
  catalog: Catalog;
  filters: SearchFilters;
  onApply: (next: SearchFilters) => void;
  onClose: () => void;
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
    if (priceError) return;
    onApply(fromDraft(draft));
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

          <div className="flex items-center justify-between gap-4">
            <span id={videoLabelId} className="text-[15px] font-semibold">
              Sadece videolu ilanlar
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={draft.videoOnly}
              aria-labelledby={videoLabelId}
              onClick={() => setDraft((d) => ({ ...d, videoOnly: !d.videoOnly }))}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2 ${
                draft.videoOnly ? "bg-[#E5484D]" : "bg-[#C9CED6]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform ${
                  draft.videoOnly ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
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
            disabled={Boolean(priceError)}
            className="h-12 flex-[2] rounded-md bg-[#003399] text-[16px] font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
          >
            İlanları göster
          </button>
        </div>
      </form>
    </dialog>
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

function PinIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps} className={className} aria-hidden="true">
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.25" />
    </svg>
  );
}

function PlayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.9-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z"
        fill="currentColor"
      />
    </svg>
  );
}