"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  VEHICLE_PARAM,
  buildHomeHref,
  filterParamsNeedCatalog,
  filtersKey,
  hasFilterParams,
  portalFiltersFromParams,
} from "./portal";
import { countActiveFilters, fetchCatalogCached, type Catalog, type SearchFilters } from "./search";

// Ana sayfanın filtreleri adres çubuğunda durur (/?marka=bmw&minFiyat=500000):
// sayfa yenilenince ya da bağlantı paylaşılınca aynı sonuçlar gelir. Okuma
// useSearchParams ile, yazma window.history.replaceState ile (Next.js yönlendiricisi
// bunu useSearchParams'a yansıtır; sunucuya istek gitmez, sayfa yeniden kurulmaz).
// Marka/model adreste slug olarak durduğu için filtre, katalog gelene kadar
// çözülemez (null); o sırada yanlış (filtresiz) sonuç istenmez.

const EMPTY_CATALOG: Catalog = { brands: [], models: [] };
/** Mobilde katalog (filtre penceresi için) akışın ilk isteğiyle yarışmasın */
const LAZY_CATALOG_DELAY_MS = 2000;

export type HomeFilters = {
  /** Marka/model seçenekleri; yüklenmediyse null */
  catalog: Catalog | null;
  catalogFailed: boolean;
  /** Adresteki filtreler; katalog bekleniyorsa null */
  filters: SearchFilters | null;
  /** Filtrelerin kanonik sorgu metni (liste anahtarı); filtre yoksa "" */
  key: string | null;
  /** Rozet: uygulanan filtre sayısı (sıralama sayılmaz) */
  activeCount: number;
  /** Filtreleri adrese yazar; ?v= (açık ilan) kaldırılır */
  apply: (next: SearchFilters) => void;
  /** Penceredeki ilan (?v=): açılınca yazılır, kapanınca kaldırılır */
  setVehicleParam: (vehicleId: string | null) => void;
  /** Kataloğu hemen iste (filtre penceresi açılırken) */
  loadCatalog: () => Promise<Catalog | null>;
};

export function useHomeFilters({ eagerCatalog }: { eagerCatalog: boolean }): HomeFilters {
  const searchParams = useSearchParams();
  const needsCatalog = filterParamsNeedCatalog(searchParams);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const requestRef = useRef<Promise<Catalog | null> | null>(null);

  const loadCatalog = useCallback(() => {
    if (!requestRef.current) {
      const request: Promise<Catalog | null> = fetchCatalogCached().then(
        (loaded) => {
          setCatalog(loaded);
          setCatalogFailed(false);
          return loaded;
        },
        (error) => {
          console.error("Marka/model listesi yüklenemedi:", error);
          // Sonraki istek (ör. pencere yeniden açılınca) tekrar dener
          requestRef.current = null;
          setCatalogFailed(true);
          return null;
        },
      );
      requestRef.current = request;
    }
    return requestRef.current;
  }, []);

  useEffect(() => {
    if (catalog) return;
    if (eagerCatalog || needsCatalog) {
      void loadCatalog();
      return;
    }
    const timer = window.setTimeout(() => void loadCatalog(), LAZY_CATALOG_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [catalog, eagerCatalog, needsCatalog, loadCatalog]);

  // Katalog gerekmiyorsa (fiyat, yıl, şehir…) ya da hiç yüklenemediyse boş katalogla
  // çözülür: marka/model süzgeci o durumda uygulanamaz, diğerleri uygulanır
  const resolvedCatalog = catalog ?? (catalogFailed || !needsCatalog ? EMPTY_CATALOG : null);
  const filters = useMemo(
    () => (resolvedCatalog ? portalFiltersFromParams(searchParams, resolvedCatalog) : null),
    [searchParams, resolvedCatalog],
  );
  const key = filters && resolvedCatalog ? filtersKey(filters, resolvedCatalog) : null;

  // Eş adlı ya da adla yazılmış bağlantı (?brand=BMW) kanonik biçime çevrilir.
  // Katalog yüklenemediyse dokunulmaz: marka parametresi silinmesin.
  useEffect(() => {
    if (!filters || !hasFilterParams(searchParams)) return;
    if (needsCatalog && !catalog) return;
    const canonical = buildHomeHref(searchParams, filters, resolvedCatalog ?? EMPTY_CATALOG);
    const current = `${window.location.pathname}${window.location.search}`;
    if (window.location.pathname === "/" && canonical !== current) window.history.replaceState(null, "", canonical);
  }, [filters, searchParams, needsCatalog, catalog, resolvedCatalog]);

  const apply = useCallback(
    (next: SearchFilters) => {
      const href = buildHomeHref(new URLSearchParams(window.location.search), next, catalog ?? EMPTY_CATALOG, null);
      window.history.replaceState(null, "", href);
    },
    [catalog],
  );

  const setVehicleParam = useCallback((vehicleId: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (vehicleId) params.set(VEHICLE_PARAM, vehicleId);
    else params.delete(VEHICLE_PARAM);
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/?${query}` : "/");
  }, []);

  return {
    catalog,
    catalogFailed,
    filters,
    key,
    activeCount: filters ? countActiveFilters(filters) : 0,
    apply,
    setVehicleParam,
    loadCatalog,
  };
}
