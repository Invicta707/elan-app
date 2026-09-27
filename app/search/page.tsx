import type { Metadata, Viewport } from "next";
import SearchView from "../../components/SearchView";
import {
  EMPTY_FILTERS,
  FOCUS_PARAM,
  fetchCatalogCached,
  filtersFromSearchParams,
  filtersToSearchParams,
  searchVehicles,
  type Catalog,
  type RawSearchParams,
  type SearchFilters,
  type SearchPage,
} from "../../lib/search";
import { bodyFont, displayFont } from "../fonts";

export const metadata: Metadata = {
  title: "İlan ara | gözüyle",
  description: "Marka, model, fiyat ve şehre göre videolu ve fotoğraflı araç ilanlarını ara.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F2F3F5",
};

type SearchPageProps = {
  searchParams: Promise<RawSearchParams>;
};

// Filtreler URL'den okunur ve ilk sonuç sayfası sunucuda hazırlanır:
// sayfa boş bir yükleniyor ekranıyla açılmaz, link paylaşılabilir.
export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;

  let catalog: Catalog = { brands: [], models: [] };
  let filters: SearchFilters = EMPTY_FILTERS;
  let firstPage: SearchPage | null = null;

  try {
    // Marka/model URL'de slug olarak durur; id'lere çevirmek için önce katalog gerekir
    catalog = await fetchCatalogCached();
    filters = filtersFromSearchParams(params, catalog);
    firstPage = await searchVehicles(filters, 0);
  } catch (error) {
    console.error("Arama sayfası yüklenemedi:", error);
  }

  const loadFailed = firstPage === null;
  // Filtre ya da yükleme durumu değişince istemcideki liste sıfırdan kurulur
  const viewKey = `${filtersToSearchParams(filters, catalog).toString()}|${loadFailed ? "error" : "ok"}`;

  return (
    <main
      className={`${displayFont.variable} ${bodyFont.variable} min-h-dvh w-full bg-[#F2F3F5] text-[#15181C] [font-family:var(--font-body)]`}
    >
      <SearchView
        key={viewKey}
        catalog={catalog}
        filters={filters}
        initialResults={firstPage?.items ?? []}
        initialNextOffset={firstPage?.nextOffset ?? 0}
        initialHasMore={firstPage?.hasMore ?? false}
        loadFailed={loadFailed}
        autoFocusSearch={params[FOCUS_PARAM] === "1"}
      />
    </main>
  );
}