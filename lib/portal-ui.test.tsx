// @vitest-environment happy-dom
//
// Masaüstü vitrinin parçaları: filtre konsolu (esnek, anında uygulanan
// arama; sıfırlama, rozet), kartın fareyle önizlemesi (hls.js'in kurulup
// bırakılması), bölünmüş pencere (↑/↓, kapatma yolları, iç pencereler) ve
// sayfalı liste deposu.

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: (allProps: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => {
    const props = { ...allProps };
    delete props.fill;
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));
vi.mock("../app/fonts", () => ({ displayFont: { variable: "" }, bodyFont: { variable: "" } }));
vi.mock("./supabase", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock("./use-follow", () => ({ primeSellerProfiles: vi.fn(async () => {}) }));
vi.mock("../components/feed/DesktopFeedPanel", () => ({
  default: ({ vehicle, lightboxContainer }: { vehicle: { brandName: string; modelName: string }; lightboxContainer?: Element | null }) => (
    <div data-testid="panel" data-has-container={String(Boolean(lightboxContainer))}>
      {vehicle.brandName} {vehicle.modelName}
      <textarea aria-label="Yorum yaz" />
    </div>
  ),
}));

type FakeHlsInstance = {
  config: Record<string, unknown>;
  loadSource: ReturnType<typeof vi.fn>;
  attachMedia: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};
const hls = vi.hoisted(() => ({ instances: [] as FakeHlsInstance[] }));
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
    startLoad = vi.fn();
    recoverMediaError = vi.fn();
    constructor(public config: Record<string, unknown>) {
      hls.instances.push(this as unknown as FakeHlsInstance);
    }
  }
  return { default: FakeHls };
});

import FilterConsole, { TEXT_APPLY_DELAY_MS } from "../components/portal/FilterConsole";
import PortalCard from "../components/portal/PortalCard";
import PortalModal from "../components/portal/PortalModal";
import { usePortalList } from "../components/portal/usePortalList";
import { PREVIEW_DELAY_MS, type PortalPage, type PortalVehicle } from "./portal";
import { EMPTY_FILTERS, type Catalog, type SearchFilters } from "./search";

const catalog: Catalog = {
  brands: [
    { id: "b-bmw", name: "BMW", slug: "bmw" },
    { id: "b-vw", name: "Volkswagen", slug: "volkswagen" },
  ],
  models: [
    { id: "m-320", brandId: "b-bmw", name: "3 Serisi", slug: "3-serisi" },
    { id: "m-passat", brandId: "b-vw", name: "Passat", slug: "passat" },
  ],
};

const vehicle = (id: string, overrides: Partial<PortalVehicle> = {}): PortalVehicle => ({
  id,
  sellerId: `seller-${id}`,
  brandName: "BMW",
  modelName: `Model ${id}`,
  year: 2019,
  price: 1_250_000,
  currency: "TRY",
  mileageKm: 85_000,
  fuelType: "dizel",
  transmission: "otomatik",
  city: "İstanbul",
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

beforeEach(() => {
  hls.instances.length = 0;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------
// Filtre konsolu
// ---------------------------------------------------------------

function renderConsole(filters: SearchFilters = EMPTY_FILTERS, activeCount = 0) {
  const onApply = vi.fn();
  const onShowResults = vi.fn();
  const view = render(
    <FilterConsole
      catalog={catalog}
      catalogFailed={false}
      filters={filters}
      activeCount={activeCount}
      onApply={onApply}
      onShowResults={onShowResults}
    />,
  );
  return { ...view, onApply, onShowResults };
}

describe("FilterConsole", () => {
  it("dokuz alan var, hiçbiri zorunlu değil", () => {
    renderConsole();
    for (const label of ["Marka", "Model", "Şehir", "Vites", "Yakıt", "En az fiyat", "En çok fiyat", "En eski model yılı", "En yeni model yılı"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByLabelText<HTMLSelectElement>("Model").disabled).toBe(true);
    expect(screen.getAllByRole("textbox").every((input) => !(input as HTMLInputElement).required)).toBe(true);
  });

  it("tek seçim kutusu bile hemen uygulanır; diğer alanlar boş kalır", () => {
    const { onApply } = renderConsole();
    fireEvent.change(screen.getByLabelText("Marka"), { target: { value: "b-bmw" } });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, brandId: "b-bmw" });
    // Marka seçilince model açılır, yalnızca o markanın modelleri
    const model = screen.getByLabelText<HTMLSelectElement>("Model");
    expect(model.disabled).toBe(false);
    expect([...model.options].map((option) => option.textContent)).toEqual(["Tüm modeller", "3 Serisi"]);

    fireEvent.change(screen.getByLabelText("Yakıt"), { target: { value: "lpg" } });
    expect(onApply).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, brandId: "b-bmw", fuelTypes: ["lpg"] });
  });

  it("sayı alanı yazmaya ara verilince uygulanır, binlik ayraçla görünür", () => {
    vi.useFakeTimers();
    const { onApply } = renderConsole();
    const input = screen.getByLabelText<HTMLInputElement>("En az fiyat");
    fireEvent.change(input, { target: { value: "500000" } });
    expect(input.value).toBe("500.000");
    act(() => {
      vi.advanceTimersByTime(TEXT_APPLY_DELAY_MS - 1);
    });
    expect(onApply).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onApply).toHaveBeenCalledWith({ ...EMPTY_FILTERS, minPrice: 500_000 });
  });

  it("ters fiyat aralığında uyarı çıkar ve uygulanmaz", () => {
    vi.useFakeTimers();
    const { onApply } = renderConsole();
    fireEvent.change(screen.getByLabelText("En az fiyat"), { target: { value: "900000" } });
    fireEvent.change(screen.getByLabelText("En çok fiyat"), { target: { value: "500000" } });
    act(() => {
      vi.advanceTimersByTime(TEXT_APPLY_DELAY_MS * 2);
    });
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText("En az fiyat, en çok fiyattan büyük olamaz.")).toBeTruthy();
  });

  it("\"İlanları Göster\" beklemeden uygular ve sonuçlara kaydırır (sonra ikinci kez uygulamaz)", () => {
    vi.useFakeTimers();
    const { onApply, onShowResults } = renderConsole();
    fireEvent.change(screen.getByLabelText("En eski model yılı"), { target: { value: "2018" } });
    fireEvent.click(screen.getByRole("button", { name: "İlanları Göster" }));
    expect(onApply).toHaveBeenCalledWith({ ...EMPTY_FILTERS, minYear: 2018 });
    expect(onShowResults).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(TEXT_APPLY_DELAY_MS * 2);
    });
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("rozet uygulanan filtre sayısı; \"Filtreleri Sıfırla\" hepsini temizler, sıralama kalır", () => {
    const filters: SearchFilters = { ...EMPTY_FILTERS, brandId: "b-bmw", minPrice: 400_000, sort: "price_asc" };
    const { onApply } = renderConsole(filters, 2);
    expect(screen.getByText("2 filtre")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("En az fiyat").value).toBe("400.000");
    fireEvent.click(screen.getByRole("button", { name: /Filtreleri Sıfırla/ }));
    expect(onApply).toHaveBeenCalledWith({ ...EMPTY_FILTERS, sort: "price_asc" });
    expect(screen.getByLabelText<HTMLInputElement>("En az fiyat").value).toBe("");
    expect(screen.getByLabelText<HTMLSelectElement>("Marka").value).toBe("");
  });

  it("filtre yokken sıfırlama kapalı", () => {
    renderConsole();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Filtreleri Sıfırla/ }).disabled).toBe(true);
  });

  it("filtreler dışarıdan değişince alanlar onlardan yeniden kurulur", () => {
    const filters: SearchFilters = { ...EMPTY_FILTERS, city: "Ankara", maxYear: 2020 };
    const view = renderConsole(filters, 2);
    expect(screen.getByLabelText<HTMLSelectElement>("Şehir").value).toBe("Ankara");
    view.rerender(
      <FilterConsole catalog={catalog} catalogFailed={false} filters={EMPTY_FILTERS} activeCount={0} onApply={view.onApply} onShowResults={view.onShowResults} />,
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Şehir").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("En yeni model yılı").value).toBe("");
  });

  it("adresten gelen çoklu yakıt seçimi kutuda görünür ve korunur", () => {
    const filters: SearchFilters = { ...EMPTY_FILTERS, fuelTypes: ["dizel", "hibrit"] };
    const { onApply } = renderConsole(filters, 1);
    const fuel = screen.getByLabelText<HTMLSelectElement>("Yakıt");
    expect(fuel.selectedOptions[0].textContent).toBe("Dizel, Hibrit");
    fireEvent.change(screen.getByLabelText("Vites"), { target: { value: "manuel" } });
    expect(onApply).toHaveBeenCalledWith({ ...filters, transmissions: ["manuel"] });
  });

  it("katalog yüklenirken marka kutusu kapalı", () => {
    render(
      <FilterConsole catalog={null} catalogFailed={false} filters={EMPTY_FILTERS} activeCount={0} onApply={vi.fn()} onShowResults={vi.fn()} />,
    );
    const brand = screen.getByLabelText<HTMLSelectElement>("Marka");
    expect(brand.disabled).toBe(true);
    expect(brand.options[0].textContent).toBe("Yükleniyor…");
  });
});

// ---------------------------------------------------------------
// Kart ve fareyle önizleme
// ---------------------------------------------------------------

function renderCard(item: PortalVehicle = vehicle("a"), previewEnabled = true) {
  const onOpen = vi.fn();
  const view = render(<PortalCard vehicle={item} eager={false} previewEnabled={previewEnabled} onOpen={onOpen} now={new Date("2026-09-28T12:00:00")} />);
  const link = view.container.querySelector("a")!;
  return { ...view, onOpen, link };
}

describe("PortalCard", () => {
  it("dikey kapak, başlık, fiyat, yıl/km, il ve eklenme günü; bağlantı ilan sayfası", () => {
    const { link } = renderCard();
    expect(link.getAttribute("href")).toBe("/vehicles/a");
    expect(link.querySelector("img")?.getAttribute("src")).toBe("https://video/a.jpg");
    expect(link.textContent).toContain("BMW Model a");
    expect(link.textContent).toContain("1.250.000");
    expect(link.textContent).toContain("2019 · 85.000 km");
    expect(link.textContent).toContain("İstanbul · Dün");
    expect(link.querySelector("[data-play-mark='visible']")).not.toBeNull();
  });

  it("fare üstünde kalınca video sessiz oynar; çekilince hls.js yok edilir, video kalkar, kapak döner", async () => {
    const { link, container } = renderCard();
    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    expect(container.querySelector("[data-preview-video]")).toBeNull();

    await waitFor(() => expect(container.querySelector("[data-preview-video]")).not.toBeNull(), { timeout: PREVIEW_DELAY_MS + 500 });
    const video = container.querySelector<HTMLVideoElement>("[data-preview-video]")!;
    await waitFor(() => expect(hls.instances).toHaveLength(1));
    const instance = hls.instances[0];
    expect(instance.loadSource).toHaveBeenCalledWith("https://video/a.m3u8");
    expect(instance.attachMedia).toHaveBeenCalledWith(video);
    expect(instance.config).toMatchObject({ capLevelToPlayerSize: true, maxBufferLength: 8 });
    expect(video.muted).toBe(true);

    fireEvent.playing(video);
    expect(link.querySelector("[data-play-mark='hidden']")).not.toBeNull();

    // Kısa döngü: 6. saniyede başa
    Object.defineProperty(video, "currentTime", { value: 6.2, writable: true, configurable: true });
    fireEvent.timeUpdate(video);
    expect(video.currentTime).toBe(0);

    fireEvent.pointerLeave(link, { pointerType: "mouse" });
    expect(container.querySelector("[data-preview-video]")).toBeNull();
    expect(instance.destroy).toHaveBeenCalledTimes(1);
    expect(link.querySelector("[data-play-mark='visible']")).not.toBeNull();
  });

  it("gecikmeden önce çekilirse video hiç kurulmaz; dokunmatik ve pencere açıkken önizleme yok", async () => {
    const first = renderCard();
    fireEvent.pointerEnter(first.link, { pointerType: "mouse" });
    fireEvent.pointerLeave(first.link, { pointerType: "mouse" });
    fireEvent.pointerEnter(first.link, { pointerType: "touch" });
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_DELAY_MS + 60));
    expect(first.container.querySelector("[data-preview-video]")).toBeNull();
    first.unmount();

    const suspended = renderCard(vehicle("b"), false);
    fireEvent.pointerEnter(suspended.link, { pointerType: "mouse" });
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_DELAY_MS + 60));
    expect(suspended.container.querySelector("[data-preview-video]")).toBeNull();
    expect(hls.instances).toHaveLength(0);
  });

  it("videosuz ilanda oynat işareti ve önizleme yok", async () => {
    const { link, container } = renderCard(vehicle("c", { hlsUrl: null }));
    expect(link.querySelector("[data-play-mark]")).toBeNull();
    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_DELAY_MS + 60));
    expect(container.querySelector("[data-preview-video]")).toBeNull();
  });

  it("tıklama pencereyi açar (sayfa değişmez); Ctrl/orta tık tarayıcıya kalır", () => {
    const { link, onOpen } = renderCard();
    const ctrl = fireEvent.click(link, { ctrlKey: true, button: 0 });
    expect(ctrl).toBe(true);
    expect(onOpen).not.toHaveBeenCalled();
    const plain = fireEvent.click(link, { button: 0 });
    expect(plain).toBe(false); // preventDefault: gezinme yok
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------
// Bölünmüş pencere
// ---------------------------------------------------------------

function renderModal(overrides: Partial<Parameters<typeof PortalModal>[0]> = {}) {
  const props = {
    vehicle: vehicle("b"),
    position: 2 as number | null,
    total: 5,
    moreAvailable: true,
    hasPrev: true,
    hasNext: true,
    loadingNext: false,
    neighborSellerIds: ["seller-a", "seller-c"],
    muted: false,
    onMutedChange: vi.fn(),
    onStep: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<PortalModal {...props} />);
  return { ...view, props, dialog: document.querySelector<HTMLDialogElement>("[data-portal-modal]")! };
}

describe("PortalModal", () => {
  it("modal pencere: solda video, sağda panel (fotoğraf görüntüleyici pencerenin içinde), sayaç", async () => {
    const { dialog } = renderModal();
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("aria-label")).toBe("2019 BMW Model b ilanı");
    expect(dialog.querySelector("video")?.getAttribute("aria-label")).toBe("2019 BMW Model b videosu");
    expect(screen.getByTestId("panel").textContent).toContain("BMW Model b");
    await waitFor(() => expect(screen.getByTestId("panel").dataset.hasContainer).toBe("true"));
    expect(dialog.textContent).toContain("2 / 5+");
    await waitFor(() => expect(hls.instances[0]?.loadSource).toHaveBeenCalledWith("https://video/b.m3u8"));
    expect(document.documentElement.style.overflow).toBe("hidden");
  });

  it("↓ sonraki, ↑ önceki; yazı alanında ok tuşu yazıya kalır", () => {
    const { props } = renderModal();
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(props.onStep).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    expect(props.onStep).toHaveBeenLastCalledWith(-1);
    fireEvent.keyDown(screen.getByLabelText("Yorum yaz"), { key: "ArrowDown" });
    expect(props.onStep).toHaveBeenCalledTimes(2);
  });

  it("önceki/sonraki düğmeleri; listenin başında önceki kapalı; paylaşılan ilanda sayaç yok", () => {
    const { props } = renderModal({ hasPrev: false, position: 1 });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Önceki ilan" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Sonraki ilan" }));
    expect(props.onStep).toHaveBeenCalledWith(1);
    cleanup();
    renderModal({ position: null });
    expect(screen.getByText("Paylaşılan ilan")).toBeTruthy();
  });

  it("X ve karartılmış alana tıklamak kapatır; kaydırma kilidi kalkar", async () => {
    const first = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Pencereyi kapat" }));
    await waitFor(() => expect(first.props.onClose).toHaveBeenCalledTimes(1));
    first.unmount();
    expect(document.documentElement.style.overflow).toBe("");

    const second = renderModal();
    fireEvent.click(second.dialog);
    await waitFor(() => expect(second.props.onClose).toHaveBeenCalledTimes(1));
  });

  it("içteki pencerenin close olayı dış pencereyi kapatmaz; içteyken ok tuşu gezinmez", () => {
    const { props, dialog } = renderModal();
    const inner = document.createElement("dialog");
    document.body.appendChild(inner);
    inner.showModal();
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(props.onStep).not.toHaveBeenCalled();
    inner.close();
    inner.remove();

    // React, içteki pencerenin close olayını bileşen ağacında dışa da iletir
    fireEvent(dialog.querySelector("textarea")!, new Event("close", { bubbles: true }));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("gösterilen ve komşu ilanların satıcıları önceden istenir", async () => {
    const { primeSellerProfiles } = await import("./use-follow");
    renderModal();
    await waitFor(() => expect(primeSellerProfiles).toHaveBeenCalledWith(["seller-b", "seller-a", "seller-c"]));
  });
});

// ---------------------------------------------------------------
// Sayfalı liste deposu
// ---------------------------------------------------------------

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("usePortalList", () => {
  it("anahtarın ilk sayfası, sonra sayfalar eklenir (tekrar eden atlanır)", async () => {
    const fetchPage = vi.fn(async (cursor: number | null): Promise<PortalPage<number>> =>
      cursor === null
        ? { items: [vehicle("a"), vehicle("b")], next: 2, hasMore: true }
        : { items: [vehicle("b"), vehicle("c")], next: 4, hasMore: false },
    );
    const { result } = renderHook(() => usePortalList("k1", fetchPage));
    expect(result.current.initial).toBe(true);
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(["a", "b"]));
    expect(result.current).toMatchObject({ loading: false, hasMore: true });

    let fresh: PortalVehicle[] = [];
    await act(async () => {
      fresh = await result.current.loadMore();
    });
    expect(fetchPage).toHaveBeenLastCalledWith(2);
    expect(fresh.map((item) => item.id)).toEqual(["c"]);
    expect(result.current.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(result.current.hasMore).toBe(false);
  });

  it("anahtar değişince eski kartlar soluk kalır; geç gelen eski yanıt yenisinin üstüne yazılmaz", async () => {
    const slow = deferred<PortalPage<number>>();
    const fast = deferred<PortalPage<number>>();
    const fetchPage = vi.fn(() => (fetchPage.mock.calls.length === 1 ? slow.promise : fast.promise));
    const { result, rerender } = renderHook(({ listKey }) => usePortalList(listKey, fetchPage), { initialProps: { listKey: "eski" } });
    rerender({ listKey: "yeni" });
    await act(async () => {
      fast.resolve({ items: [vehicle("yeni")], next: 1, hasMore: false });
    });
    await act(async () => {
      slow.resolve({ items: [vehicle("eski")], next: 1, hasMore: false });
    });
    expect(result.current.items.map((item) => item.id)).toEqual(["yeni"]);
    expect(result.current.loading).toBe(false);
  });

  it("ilk sayfa yüklenemezse hata; Tekrar dene yeniden ister", async () => {
    const fetchPage = vi
      .fn<(cursor: number | null) => Promise<PortalPage<number>>>()
      .mockRejectedValueOnce(new Error("ağ"))
      .mockResolvedValueOnce({ items: [vehicle("a")], next: 1, hasMore: false });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => usePortalList("k", fetchPage));
    await waitFor(() => expect(result.current.failed).toBe(true));
    act(() => result.current.retry());
    expect(result.current.failed).toBe(false);
    await waitFor(() => expect(result.current.items).toHaveLength(1));
  });

  it("anahtar null iken istek yok", () => {
    const fetchPage = vi.fn();
    const { result } = renderHook(() => usePortalList(null, fetchPage));
    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ loading: false, initial: false, items: [] });
  });
});
