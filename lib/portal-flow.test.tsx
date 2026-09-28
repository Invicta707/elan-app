// @vitest-environment happy-dom
//
// Ana sayfanın filtre ve vitrin akışı uçtan uca (sahte veriyle): masaüstünde
// vitrin → karta tıkla → pencere → ↑/↓ (gerekirse sonraki sayfa) → kapat ve
// odak karta; paylaşılan ilan (?v=); adres hook'u (useSearchParams okuma,
// replaceState yazma, eş adların kanonik biçime çevrilmesi); mobilde filtre
// hapı ve filtreli video akışı.

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, ImgHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: (allProps: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => {
    const props = { ...allProps };
    delete props.fill;
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => nav.params,
}));
vi.mock("../app/fonts", () => ({ displayFont: { variable: "" }, bodyFont: { variable: "" } }));
vi.mock("./supabase", () => ({ supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock("./auth", () => ({ useSupabaseSession: () => ({ session: null, isLoading: false }) }));
vi.mock("./use-my-profile", () => ({ useMyProfile: () => ({ profile: null, loading: false, failed: false }) }));
vi.mock("./use-follow", () => ({ useFollowVersion: () => 0, primeSellerProfiles: vi.fn(async () => {}) }));
vi.mock("../components/HeaderProfileButton", () => ({ default: () => <span data-testid="profil" /> }));
vi.mock("../components/AuthGatedLink", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
  AuthModalPortal: () => <div>giriş penceresi</div>,
}));
vi.mock("../components/feed/DesktopFeedPanel", () => ({
  default: ({ vehicle }: { vehicle: { brandName: string; modelName: string } }) => (
    <div data-testid="panel">
      {vehicle.brandName} {vehicle.modelName}
    </div>
  ),
}));
vi.mock("../components/VideoCard", () => ({
  default: ({ vehicle }: { vehicle: { id: string; brandName: string } }) => <article data-card={vehicle.id}>{vehicle.brandName}</article>,
}));
vi.mock("hls.js", () => {
  class FakeHls {
    static isSupported() {
      return true;
    }
    static Events = { ERROR: "hlsError" };
    static ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" };
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    on = vi.fn();
  }
  return { default: FakeHls };
});

const api = vi.hoisted(() => ({
  searchPortalPage: vi.fn(),
  fetchFollowingPortalPage: vi.fn(),
  fetchPortalVehicle: vi.fn(),
  fetchFilteredFeedPage: vi.fn(),
  fetchCatalogCached: vi.fn(),
  fetchFeedPage: vi.fn(),
  fetchFeedVehicle: vi.fn(),
}));
vi.mock("./portal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./portal")>()),
  searchPortalPage: api.searchPortalPage,
  fetchFollowingPortalPage: api.fetchFollowingPortalPage,
  fetchPortalVehicle: api.fetchPortalVehicle,
  fetchFilteredFeedPage: api.fetchFilteredFeedPage,
}));
vi.mock("./search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./search")>()),
  fetchCatalogCached: api.fetchCatalogCached,
}));
vi.mock("./feed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./feed")>()),
  fetchFeedPage: api.fetchFeedPage,
  fetchFeedVehicle: api.fetchFeedVehicle,
}));

import VideoFeed from "../components/VideoFeed";
import FeedFilterButton from "../components/feed/FeedFilterButton";
import DesktopPortal from "../components/portal/DesktopPortal";
import type { PortalVehicle } from "./portal";
import { EMPTY_FILTERS, type Catalog, type SearchFilters } from "./search";
import { useHomeFilters, type HomeFilters } from "./use-home-filters";

const catalog: Catalog = {
  brands: [
    { id: "b-bmw", name: "BMW", slug: "bmw" },
    { id: "b-vw", name: "Volkswagen", slug: "volkswagen" },
  ],
  models: [{ id: "m-320", brandId: "b-bmw", name: "3 Serisi", slug: "3-serisi" }],
};

const vehicle = (id: string, overrides: Partial<PortalVehicle> = {}): PortalVehicle => ({
  id,
  sellerId: `seller-${id}`,
  brandName: "BMW",
  modelName: `Model ${id}`,
  year: 2019,
  price: 1_000_000,
  currency: "TRY",
  mileageKm: 50_000,
  fuelType: "dizel",
  transmission: "otomatik",
  city: "Ankara",
  tramerAmount: 0,
  hasHeavyDamage: false,
  paintedPartsCount: 0,
  changedPartsCount: 0,
  commentsCount: 0,
  hlsUrl: `https://video/${id}.m3u8`,
  posterUrl: `https://video/${id}.jpg`,
  photoUrl: `https://photo/${id}.jpeg`,
  isTest: false,
  createdAt: "2026-09-27T10:00:00+00:00",
  ...overrides,
});

function homeFilters(overrides: Partial<HomeFilters> = {}): HomeFilters {
  return {
    catalog,
    catalogFailed: false,
    filters: EMPTY_FILTERS,
    key: "",
    activeCount: 0,
    apply: vi.fn(),
    setVehicleParam: vi.fn(),
    loadCatalog: vi.fn(async () => catalog),
    ...overrides,
  };
}

class FakeIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.fetchFollowingPortalPage.mockResolvedValue({ items: [], next: null, hasMore: false });
  api.fetchPortalVehicle.mockResolvedValue(null);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  nav.params = new URLSearchParams();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const counter = () => document.querySelector("[data-portal-modal] [aria-live='polite']")?.textContent;
const panel = () => screen.queryByTestId("panel")?.textContent;

describe("masaüstü vitrin: pencere akışı", () => {
  it("karta tıkla → pencere; ↓/↑ listede gezinir, adres ?v= ile güncellenir; kapatınca odak son karta döner", async () => {
    api.searchPortalPage.mockResolvedValue({ items: [vehicle("a"), vehicle("b"), vehicle("c")], next: 3, hasMore: false });
    const home = homeFilters();
    render(<DesktopPortal home={home} initialVehicleId={null} initialTab="explore" />);

    await waitFor(() => expect(document.querySelectorAll("[data-portal-card]")).toHaveLength(3));
    expect(api.searchPortalPage).toHaveBeenCalledWith(EMPTY_FILTERS, 0);
    expect(screen.getByText("3 videolu ilan")).toBeTruthy();
    // Vitrin: grid-cols-4, xl'de 5 sütun
    expect(screen.getByRole("list", { name: "Videolu ilanlar" }).className).toContain("grid-cols-4");
    expect(screen.getByRole("list", { name: "Videolu ilanlar" }).className).toContain("xl:grid-cols-5");

    fireEvent.click(document.querySelector("[data-portal-card='a']")!, { button: 0 });
    expect(home.setVehicleParam).toHaveBeenLastCalledWith("a");
    expect(counter()).toContain("1 / 3");
    expect(panel()).toContain("Model a");

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(counter()).toContain("2 / 3");
    expect(panel()).toContain("Model b");
    expect(home.setVehicleParam).toHaveBeenLastCalledWith("b");

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(counter()).toContain("3 / 3");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Sonraki ilan" }).disabled).toBe(true);

    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    expect(panel()).toContain("Model b");

    fireEvent.click(screen.getByRole("button", { name: "Pencereyi kapat" }));
    await waitFor(() => expect(document.querySelector("[data-portal-modal]")).toBeNull());
    expect(home.setVehicleParam).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(document.activeElement?.getAttribute("data-portal-card")).toBe("b"));
  });

  it("listenin sonunda ↓ sonraki sayfayı ister ve yeni ilana geçer", async () => {
    api.searchPortalPage
      .mockResolvedValueOnce({ items: [vehicle("a"), vehicle("b")], next: 2, hasMore: true })
      .mockResolvedValueOnce({ items: [vehicle("c")], next: 3, hasMore: false });
    render(<DesktopPortal home={homeFilters()} initialVehicleId={null} initialTab="explore" />);
    await waitFor(() => expect(document.querySelectorAll("[data-portal-card]")).toHaveLength(2));
    expect(screen.getByText("2+ videolu ilan")).toBeTruthy();

    fireEvent.click(document.querySelector("[data-portal-card='b']")!, { button: 0 });
    expect(counter()).toContain("2 / 2+");
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    await waitFor(() => expect(panel()).toContain("Model c"));
    expect(api.searchPortalPage).toHaveBeenLastCalledWith(EMPTY_FILTERS, 2);
    expect(counter()).toContain("3 / 3");
  });

  it("paylaşılan ilan (?v=) pencereyle açılır; yayında değilse bilgi verilir ve ?v= kalkar", async () => {
    api.searchPortalPage.mockResolvedValue({ items: [vehicle("a")], next: 1, hasMore: false });
    api.fetchPortalVehicle.mockResolvedValueOnce(vehicle("paylasilan"));
    const first = render(<DesktopPortal home={homeFilters()} initialVehicleId="paylasilan" initialTab="explore" />);
    await waitFor(() => expect(panel()).toContain("Model paylasilan"));
    expect(screen.getByText("Paylaşılan ilan")).toBeTruthy();
    // Paylaşılan ilandan sonra listenin başı
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(panel()).toContain("Model a");
    first.unmount();

    api.fetchPortalVehicle.mockResolvedValueOnce(null);
    const home = homeFilters();
    render(<DesktopPortal home={home} initialVehicleId="silinmis" initialTab="explore" />);
    await waitFor(() => expect(screen.getByText(/artık yayında değil/)).toBeTruthy());
    expect(home.setVehicleParam).toHaveBeenCalledWith(null);
    expect(document.querySelector("[data-portal-modal]")).toBeNull();
  });

  it("filtre konsolu adresi günceller; filtreye uyan ilan yoksa sıfırlama önerilir", async () => {
    api.searchPortalPage.mockResolvedValue({ items: [], next: 0, hasMore: false });
    const filters: SearchFilters = { ...EMPTY_FILTERS, brandId: "b-vw", sort: "price_desc" };
    const home = homeFilters({ filters, key: "marka=volkswagen&sirala=fiyat-azalan", activeCount: 1 });
    render(<DesktopPortal home={home} initialVehicleId={null} initialTab="explore" />);

    await waitFor(() => expect(screen.getByText("Bu filtrelere uyan ilan yok.")).toBeTruthy());
    expect(api.searchPortalPage).toHaveBeenCalledWith(filters, 0);
    expect(screen.getByText("Filtreye uyan videolar")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Şehir"), { target: { value: "Bursa" } });
    expect(home.apply).toHaveBeenLastCalledWith({ ...filters, city: "Bursa" });

    fireEvent.click(screen.getAllByRole("button", { name: /Filtreleri Sıfırla/ }).at(-1)!);
    expect(home.apply).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, sort: "price_desc" });
  });

  it("ilanlar yüklenemezse Tekrar dene; Takip Edilenler misafire giriş kartı", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.searchPortalPage.mockRejectedValueOnce(new Error("ağ")).mockResolvedValueOnce({ items: [vehicle("a")], next: 1, hasMore: false });
    render(<DesktopPortal home={homeFilters()} initialVehicleId={null} initialTab="explore" />);
    await waitFor(() => expect(screen.getByText("İlanlar yüklenemedi.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    await waitFor(() => expect(document.querySelectorAll("[data-portal-card]")).toHaveLength(1));

    fireEvent.click(screen.getByRole("tab", { name: "Takip Edilenler" }));
    expect(screen.getByText("Takip ettiklerin burada")).toBeTruthy();
    expect(api.fetchFollowingPortalPage).not.toHaveBeenCalled();
  });
});

describe("useHomeFilters (adres ↔ filtre)", () => {
  it("marka adreste varsa katalog gelene kadar filtre çözülmez (filtresiz istek atılmaz)", async () => {
    let resolveCatalog!: (value: Catalog) => void;
    api.fetchCatalogCached.mockReturnValue(new Promise<Catalog>((resolve) => (resolveCatalog = resolve)));
    nav.params = new URLSearchParams("marka=bmw&minFiyat=500000");
    window.history.replaceState(null, "", "/?marka=bmw&minFiyat=500000");

    const { result } = renderHook(() => useHomeFilters({ eagerCatalog: false }));
    expect(result.current.filters).toBeNull();
    expect(result.current.key).toBeNull();
    await act(async () => resolveCatalog(catalog));
    expect(result.current.filters).toEqual({ ...EMPTY_FILTERS, brandId: "b-bmw", minPrice: 500_000 });
    expect(result.current.key).toBe("marka=bmw&minFiyat=500000");
    expect(result.current.activeCount).toBe(2);
  });

  it("eş adlı bağlantı (?brand=BMW&minPrice=…) kanonik Türkçe adrese çevrilir, diğer parametreler kalır", async () => {
    api.fetchCatalogCached.mockResolvedValue(catalog);
    nav.params = new URLSearchParams("brand=BMW&minPrice=500000&v=veh-1");
    window.history.replaceState(null, "", "/?brand=BMW&minPrice=500000&v=veh-1");
    const replace = vi.spyOn(window.history, "replaceState");

    renderHook(() => useHomeFilters({ eagerCatalog: true }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(null, "", "/?marka=bmw&minFiyat=500000&v=veh-1"));
  });

  it("apply adrese yazar (açık ilan ?v= kalkar); setVehicleParam yalnızca ?v='ye dokunur", async () => {
    api.fetchCatalogCached.mockResolvedValue(catalog);
    nav.params = new URLSearchParams("feed=following&v=eski");
    window.history.replaceState(null, "", "/?feed=following&v=eski");
    const { result } = renderHook(() => useHomeFilters({ eagerCatalog: true }));
    await waitFor(() => expect(result.current.catalog).not.toBeNull());
    const replace = vi.spyOn(window.history, "replaceState");

    act(() => result.current.apply({ ...EMPTY_FILTERS, brandId: "b-bmw", maxYear: 2020 }));
    expect(replace).toHaveBeenLastCalledWith(null, "", "/?marka=bmw&maxYil=2020&feed=following");

    act(() => result.current.setVehicleParam("yeni"));
    expect(window.location.search).toBe("?marka=bmw&maxYil=2020&feed=following&v=yeni");
    act(() => result.current.setVehicleParam(null));
    expect(window.location.search).toBe("?marka=bmw&maxYil=2020&feed=following");
  });

  it("katalog yüklenemezse marka dışındaki filtreler uygulanır, adres silinmez", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.fetchCatalogCached.mockRejectedValue(new Error("ağ"));
    nav.params = new URLSearchParams("marka=bmw&sehir=izmir");
    window.history.replaceState(null, "", "/?marka=bmw&sehir=izmir");
    const replace = vi.spyOn(window.history, "replaceState");

    const { result } = renderHook(() => useHomeFilters({ eagerCatalog: true }));
    await waitFor(() => expect(result.current.catalogFailed).toBe(true));
    expect(result.current.filters).toEqual({ ...EMPTY_FILTERS, city: "İzmir" });
    expect(replace).not.toHaveBeenCalled();
  });

  it("mobilde katalog gerekmiyorsa hemen çözülür, katalog biraz sonra (filtre penceresi için) yüklenir", async () => {
    vi.useFakeTimers();
    api.fetchCatalogCached.mockResolvedValue(catalog);
    nav.params = new URLSearchParams("maxYil=2020");
    const { result } = renderHook(() => useHomeFilters({ eagerCatalog: false }));
    expect(result.current.filters).toMatchObject({ maxYear: 2020 });
    expect(api.fetchCatalogCached).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(api.fetchCatalogCached).toHaveBeenCalledTimes(1);
  });
});

describe("mobil: filtre hapı ve filtreli akış", () => {
  it("hap pencereyi açar (katalog yoksa önce ister); uygulanınca filtre adrese gider", async () => {
    const onApply = vi.fn();
    const loadCatalog = vi.fn(async () => catalog);
    const view = render(<FeedFilterButton home={homeFilters({ catalog: null, loadCatalog })} onApply={onApply} />);

    fireEvent.click(screen.getByRole("button", { name: "Filtrele" }));
    await waitFor(() => expect(document.querySelector("dialog[open]")).not.toBeNull());
    expect(loadCatalog).toHaveBeenCalledTimes(1);
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain("Videoları göster");
    expect(dialog.textContent).not.toContain("Sadece videolu ilanlar");

    view.rerender(<FeedFilterButton home={homeFilters()} onApply={onApply} />);
    fireEvent.change(screen.getByLabelText("Marka"), { target: { value: "b-bmw" } });
    fireEvent.click(screen.getByRole("button", { name: "Videoları göster" }));
    expect(onApply).toHaveBeenCalledWith({ ...EMPTY_FILTERS, brandId: "b-bmw" });
    await waitFor(() => expect(document.querySelector("dialog[open]")).toBeNull());
  });

  it("uygulanmış filtre sayısı hapta; ✕ tek dokunuşla temizler (sıralama kalır)", () => {
    const onApply = vi.fn();
    const filters: SearchFilters = { ...EMPTY_FILTERS, city: "Ankara", minYear: 2018, sort: "price_asc" };
    render(<FeedFilterButton home={homeFilters({ filters, activeCount: 2 })} onApply={onApply} />);
    expect(screen.getByRole("button", { name: "Filtreler, 2 filtre uygulandı" }).textContent).toContain("2");
    fireEvent.click(screen.getByRole("button", { name: "Filtreleri temizle" }));
    expect(onApply).toHaveBeenCalledWith({ ...EMPTY_FILTERS, sort: "price_asc" });
  });

  it("filtre varsa akış aramadan (yalnızca videolu) kurulur; boşsa özel boş durum", async () => {
    const filters: SearchFilters = { ...EMPTY_FILTERS, brandId: "b-bmw" };
    api.fetchFilteredFeedPage.mockResolvedValueOnce({
      items: [{ ...vehicle("f1"), thumbnailUrl: null, hlsUrl: "https://video/f1.m3u8" }],
      nextOffset: 1,
      hasMore: false,
    });
    const first = render(<VideoFeed filters={filters} muted onMutedChange={vi.fn()} />);
    await waitFor(() => expect(document.querySelector("[data-card='f1']")).not.toBeNull());
    expect(api.fetchFilteredFeedPage).toHaveBeenCalledWith(filters, 0, 8);
    expect(api.fetchFeedPage).not.toHaveBeenCalled();
    first.unmount();

    api.fetchFilteredFeedPage.mockResolvedValueOnce({ items: [], nextOffset: 0, hasMore: false });
    render(<VideoFeed filters={filters} muted onMutedChange={vi.fn()} emptyState={<p>filtre boş</p>} />);
    await waitFor(() => expect(screen.getByText("filtre boş")).toBeTruthy());
  });

  it("filtre yoksa akış eskisi gibi (Keşfet sorgusu)", async () => {
    api.fetchFeedPage.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    render(<VideoFeed muted onMutedChange={vi.fn()} />);
    await waitFor(() => expect(api.fetchFeedPage).toHaveBeenCalledWith(null, 8, "explore"));
    expect(api.fetchFilteredFeedPage).not.toHaveBeenCalled();
  });
});

describe("masaüstü vitrin: görselli ilanlar ve video bölümü", () => {
  it("görselli ilanlar klasik kartlarla (yalnızca fotoğraflılar); pencere bu bölümde gezinir, odak fotoğraf kartına döner", async () => {
    api.searchPortalPage.mockResolvedValue({
      items: [vehicle("a"), vehicle("b", { photoUrl: null }), vehicle("c", { hlsUrl: null }), vehicle("d")],
      next: 4,
      hasMore: false,
    });
    render(<DesktopPortal home={homeFilters()} initialVehicleId={null} initialTab="explore" />);

    await waitFor(() => expect(document.querySelectorAll("[data-photo-card]")).toHaveLength(3));
    expect([...document.querySelectorAll("[data-portal-card]")].map((el) => el.getAttribute("data-portal-card"))).toEqual(["a", "b", "d"]);
    expect([...document.querySelectorAll("[data-photo-card]")].map((el) => el.getAttribute("data-photo-card"))).toEqual(["a", "c", "d"]);
    expect(screen.getByRole("heading", { name: "Sizin için videolar" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Görselli ilanlar" })).toBeTruthy();
    expect(screen.getByText("3 fotoğraflı ilan · tüm ilanlar")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Görselli ilanlar" }).className).toContain("xl:grid-cols-5");

    const photoC = document.querySelector("[data-photo-card='c']")!;
    expect(photoC.querySelector("img")?.getAttribute("src")).toBe("https://photo/c.jpeg");
    expect(photoC.textContent).toContain("1.000.000 TL");
    expect(photoC.textContent).toContain("BMW Model c");
    expect(photoC.textContent).toContain("2019 · 50.000 km · Dizel · Otomatik");
    expect(photoC.textContent).toMatch(/Ankara · \S/);
    expect(photoC.textContent).not.toContain("Video");
    expect(document.querySelector("[data-photo-card='a']")!.textContent).toContain("Video");

    fireEvent.click(document.querySelector("[data-photo-card='a']")!, { button: 0 });
    expect(counter()).toContain("1 / 3");
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(panel()).toContain("Model c");
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(panel()).toContain("Model d");
    expect(counter()).toContain("3 / 3");

    fireEvent.click(screen.getByRole("button", { name: "Pencereyi kapat" }));
    await waitFor(() => expect(document.activeElement?.getAttribute("data-photo-card")).toBe("d"));
  });

  it("videolar önce 10 kart; \"Daha fazla video göster\" ekler; pencerede gizli karta gidilince bölüm genişler", async () => {
    const items = Array.from({ length: 12 }, (_, index) => vehicle(`v${index + 1}`));
    api.searchPortalPage.mockResolvedValue({ items, next: 12, hasMore: false });
    const first = render(<DesktopPortal home={homeFilters()} initialVehicleId={null} initialTab="explore" />);
    await waitFor(() => expect(document.querySelectorAll("[data-portal-card]")).toHaveLength(10));
    expect(document.querySelectorAll("[data-photo-card]")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "Daha fazla video göster" }));
    expect(document.querySelectorAll("[data-portal-card]")).toHaveLength(12);
    expect(screen.queryByRole("button", { name: "Daha fazla video göster" })).toBeNull();
    first.unmount();

    render(<DesktopPortal home={homeFilters()} initialVehicleId={null} initialTab="explore" />);
    await waitFor(() => expect(document.querySelectorAll("[data-portal-card]")).toHaveLength(10));
    fireEvent.click(document.querySelector("[data-portal-card='v10']")!, { button: 0 });
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(panel()).toContain("Model v11");
    expect(document.querySelector("[data-portal-card='v11']")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pencereyi kapat" }));
    await waitFor(() => expect(document.activeElement?.getAttribute("data-portal-card")).toBe("v11"));
  });

  it("\"Daha fazla video göster\" gerekirse sonraki sayfayı ister", async () => {
    api.searchPortalPage
      .mockResolvedValueOnce({ items: Array.from({ length: 10 }, (_, index) => vehicle(`p${index}`)), next: 10, hasMore: true })
      .mockResolvedValueOnce({ items: [vehicle("p10"), vehicle("p11")], next: 12, hasMore: false });
    render(<DesktopPortal home={homeFilters()} initialVehicleId={null} initialTab="explore" />);
    await waitFor(() => expect(document.querySelectorAll("[data-portal-card]")).toHaveLength(10));
    fireEvent.click(screen.getByRole("button", { name: "Daha fazla video göster" }));
    await waitFor(() => expect(document.querySelectorAll("[data-portal-card]")).toHaveLength(12));
    expect(api.searchPortalPage).toHaveBeenLastCalledWith(EMPTY_FILTERS, 10);
  });

  it("deneme ilanı iki kartta da \"Test ilanı\" etiketiyle", async () => {
    api.searchPortalPage.mockResolvedValue({ items: [vehicle("t", { isTest: true }), vehicle("r")], next: 2, hasMore: false });
    render(<DesktopPortal home={homeFilters()} initialVehicleId={null} initialTab="explore" />);
    await waitFor(() => expect(document.querySelectorAll("[data-photo-card]")).toHaveLength(2));
    expect(document.querySelector("[data-portal-card='t']")!.textContent).toContain("Test ilanı");
    expect(document.querySelector("[data-photo-card='t']")!.textContent).toContain("Test ilanı");
    expect(document.querySelector("[data-portal-card='r']")!.textContent).not.toContain("Test ilanı");
  });
});
