// @vitest-environment happy-dom
//
// Masaüstü Shorts oynatıcısı (components/portal/ShortsViewer.tsx): tam ekran
// 9:16 video, sol altta satıcı / başlık / fiyat, sağda Beğen · Yorum · Paylaş ·
// WhatsApp · Detaylar; ↑/↓, fare tekerleği ve oklarla kayarak geçiş; "İlan
// detayı" çekmecesi; geri düğmesi, Esc ve iç pencereler.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, ImgHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: (allProps: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean }) => {
    const props = { ...allProps };
    delete props.fill;
    delete props.unoptimized;
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
vi.mock("../app/fonts", () => ({ displayFont: { variable: "" }, bodyFont: { variable: "" } }));
vi.mock("./supabase", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

type Seller = { id: string; username: string | null; displayName: string | null; avatarUrl: string | null; isFollowing: boolean };
const sellers = vi.hoisted(() => ({ byId: new Map<string, Seller>() }));
vi.mock("./use-follow", () => ({
  primeSellerProfiles: vi.fn(async () => {}),
  useSellerProfile: (id: string | null) => (id ? (sellers.byId.get(id) ?? null) : null),
}));

const favorites = vi.hoisted(() => ({ ids: [] as string[], toggle: vi.fn(async () => "added") }));
vi.mock("./use-favorites", () => ({
  useFavorites: () => ({ ids: favorites.ids }),
  toggleFavorite: favorites.toggle,
}));

const feedApi = vi.hoisted(() => ({ getSellerWhatsAppUrl: vi.fn() }));
vi.mock("./feed", () => feedApi);

vi.mock("../components/feed/DesktopFeedPanel", () => ({
  default: ({
    vehicle,
    lightboxContainer,
    commentsRequest,
  }: {
    vehicle: { brandName: string; modelName: string };
    lightboxContainer?: Element | null;
    commentsRequest?: number;
  }) => (
    <div data-testid="panel" data-has-container={String(Boolean(lightboxContainer))} data-comments-request={String(commentsRequest ?? 0)}>
      {vehicle.brandName} {vehicle.modelName}
      <button type="button">Panel düğmesi</button>
      <textarea aria-label="Yorum yaz" />
    </div>
  ),
}));

type FakeHlsInstance = { config: Record<string, unknown>; loadSource: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
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

import ShortsViewer, { SLIDE_MS } from "../components/portal/ShortsViewer";
import { WHEEL_GESTURE_GAP_MS, WHEEL_STEP_COOLDOWN_MS } from "./feed-navigation";
import type { PortalVehicle } from "./portal";
import { formatCount } from "./showcase";
import { primeSellerProfiles } from "./use-follow";

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

type Props = Parameters<typeof ShortsViewer>[0];

function props(overrides: Partial<Props> = {}): Props {
  return {
    vehicle: vehicle("b"),
    direction: 0,
    position: 2,
    total: 5,
    moreAvailable: true,
    hasPrev: true,
    hasNext: true,
    loadingNext: false,
    neighbors: { prev: vehicle("a"), next: vehicle("c") },
    muted: false,
    onMutedChange: vi.fn(),
    onStep: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

function renderViewer(overrides: Partial<Props> = {}) {
  const current = props(overrides);
  const view = render(<ShortsViewer {...current} />);
  const dialog = document.querySelector<HTMLDialogElement>("[data-shorts-viewer]")!;
  const stage = document.querySelector<HTMLElement>("[data-shorts-stage]")!;
  return { ...view, props: current, dialog, stage };
}

const currentSlide = () => document.querySelector<HTMLElement>("[data-shorts-slide='current']")!;
const leavingSlide = () => document.querySelector<HTMLElement>("[data-shorts-slide='leaving']");
const drawer = () => document.getElementById("shorts-drawer")!;
const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>("button", { name });

beforeEach(() => {
  hls.instances.length = 0;
  sellers.byId.clear();
  sellers.byId.set("seller-b", { id: "seller-b", username: "nihad", displayName: "Nihad Oto", avatarUrl: null, isFollowing: false });
  favorites.ids = [];
  favorites.toggle.mockClear();
  feedApi.getSellerWhatsAppUrl.mockReset();
  vi.mocked(primeSellerProfiles).mockClear();
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

describe("ShortsViewer: açılış ve yerleşim", () => {
  it("tam ekran oynatıcı: 9:16 video, sol altta satıcı / başlık / fiyat, sayaç; çekmece kapalı", async () => {
    const { dialog } = renderViewer({ vehicle: vehicle("b", { isTest: true }) });
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("aria-label")).toBe("2019 BMW Model b ilanı");
    expect(document.activeElement).toBe(dialog);
    expect(document.documentElement.style.overflow).toBe("hidden");

    const frame = currentSlide().querySelector<HTMLElement>("[data-shorts-frame]")!;
    expect(frame.style.aspectRatio).toBe("9 / 16");
    expect(frame.querySelector("video")?.getAttribute("aria-label")).toBe("2019 BMW Model b videosu");
    expect(frame.querySelector("video")?.getAttribute("poster")).toBe("https://video/b.jpg");

    const info = frame.querySelector<HTMLElement>("[data-shorts-info]")!;
    expect(info.textContent).toContain("Nihad Oto");
    expect(info.querySelector("a")?.getAttribute("href")).toBe("/@nihad");
    expect(info.textContent).toContain("BMW Model b");
    expect(info.textContent).toContain("1.250.000");
    expect(info.textContent).toContain("Test ilanı");
    // Künye videonun üstünde yok: yakıt, vites, km, ekspertiz çekmecede
    expect(info.textContent).not.toMatch(/Dizel|Otomatik|85\.000/);

    expect(dialog.textContent).toContain("2 / 5+");
    expect(drawer().dataset.open).toBe("false");
    expect(screen.queryByTestId("panel")).toBeNull();

    await waitFor(() => expect(hls.instances[0]?.loadSource).toHaveBeenCalledWith("https://video/b.m3u8"));
    expect(hls.instances[0].config).toMatchObject({ capLevelToPlayerSize: true, maxBufferLength: 20 });
  });

  it("sağ sütun: Beğen, Yorum, Paylaş, WhatsApp, Detaylar (bu sırayla)", () => {
    renderViewer();
    const column = screen.getByRole("group", { name: "İlan işlemleri" });
    const names = [...column.querySelectorAll("button")].map((element) => element.getAttribute("aria-label") ?? element.textContent);
    expect(names).toEqual(["Beğen, favorilere ekle", "Yorumlar", "İlanı paylaş", "WhatsApp'tan yaz", "Detaylar"]);
    expect(column.textContent).toContain("Beğen");
  });

  it("Beğen favorilere ekler; beğenilmiş ilanda kalp dolu ve basılı", async () => {
    favorites.ids = ["b"];
    renderViewer();
    const like = button("Beğen, favorilere ekle");
    expect(like.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(like);
    await waitFor(() => expect(favorites.toggle).toHaveBeenCalledWith("b"));
  });

  it("WhatsApp satıcının numarasını ister ve yeni sekmede açar; numara yoksa bilgi verir", async () => {
    const open = vi.fn(() => ({ opener: {} }) as unknown as Window);
    vi.stubGlobal("open", open);
    feedApi.getSellerWhatsAppUrl.mockResolvedValueOnce("https://wa.me/905445673430?text=x").mockResolvedValueOnce(null);
    renderViewer();
    fireEvent.click(button("WhatsApp'tan yaz"));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://wa.me/905445673430?text=x", "_blank"));
    expect(feedApi.getSellerWhatsAppUrl).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
    fireEvent.click(button("WhatsApp'tan yaz"));
    await waitFor(() => expect(screen.getByText("Bu ilan için WhatsApp numarası bulunamadı.")).toBeTruthy());
  });

  it("duraklatınca ortada sade göz-oynat işareti (daire yok); boşluk tuşu oynatır/durdurur", async () => {
    const { dialog } = renderViewer();
    const video = currentSlide().querySelector("video")!;
    const mark = currentSlide().querySelector<HTMLElement>("[data-paused-mark]")!;
    expect(mark.dataset.pausedMark).toBe("visible");
    expect(mark.className).not.toMatch(/rounded-full|bg-black|ring-/);
    fireEvent.play(video);
    expect(mark.dataset.pausedMark).toBe("hidden");

    Object.defineProperty(video, "paused", { value: false, configurable: true });
    fireEvent.keyDown(dialog, { key: " " });
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    Object.defineProperty(video, "paused", { value: true, configurable: true });
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    fireEvent.keyDown(dialog, { key: " " });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("ilk oynatma kesildiyse video oynatılabilir olunca başlar; kullanıcı durdurduysa başlamaz", async () => {
    const { dialog } = renderViewer();
    const video = currentSlide().querySelector("video")!;
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    Object.defineProperty(video, "paused", { value: true, configurable: true });
    fireEvent.canPlay(video);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    // Kullanıcı durdurur (oynarken boşluk), sonra yeniden tampon dolar: kendiliğinden başlamaz
    Object.defineProperty(video, "paused", { value: false, configurable: true });
    fireEvent.keyDown(dialog, { key: " " });
    Object.defineProperty(video, "paused", { value: true, configurable: true });
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    fireEvent.canPlay(video);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("videosu olmayan ilanda kapak ve açıklama", () => {
    renderViewer({ vehicle: vehicle("f", { hlsUrl: null, posterUrl: "https://photo/f.jpeg" }) });
    expect(currentSlide().querySelector("video")).toBeNull();
    expect(currentSlide().querySelector("img")?.getAttribute("src")).toBe("https://photo/f.jpeg");
    expect(currentSlide().textContent).toContain("Bu ilanın videosu yok");
  });

  it("gösterilen ve komşu ilanların satıcıları ve komşu kapaklar önceden istenir", async () => {
    const loaded: string[] = [];
    vi.stubGlobal(
      "Image",
      class {
        set src(url: string) {
          loaded.push(url);
        }
      },
    );
    renderViewer();
    await waitFor(() => expect(primeSellerProfiles).toHaveBeenCalledWith(["seller-b", "seller-a", "seller-c"]));
    expect(loaded.sort()).toEqual(["https://video/a.jpg", "https://video/c.jpg"]);
  });
});

describe("ShortsViewer: gezinme", () => {
  it("↓ sonraki, ↑ önceki; yazı alanında ve çekmecede ok tuşu çekmeceye kalır", () => {
    const { props: current } = renderViewer();
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(current.onStep).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    expect(current.onStep).toHaveBeenLastCalledWith(-1);

    fireEvent.click(button("Detaylar"));
    fireEvent.keyDown(screen.getByLabelText("Yorum yaz"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Panel düğmesi" }), { key: "ArrowDown" });
    expect(current.onStep).toHaveBeenCalledTimes(2);
  });

  it("sağdaki oklar; listenin başında önceki kapalı; paylaşılan ilanda sayaç yerine etiket", () => {
    const first = renderViewer({ hasPrev: false, position: 1 });
    expect(button("Önceki ilan").disabled).toBe(true);
    fireEvent.click(button("Sonraki ilan"));
    expect(first.props.onStep).toHaveBeenCalledWith(1);
    first.unmount();
    renderViewer({ position: null });
    expect(screen.getByText("Paylaşılan ilan")).toBeTruthy();
  });

  it("fare tekerleği: bir hareket bir ilan; Ctrl+tekerlek ve listenin sonu adım atmaz", () => {
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { props: current, stage } = renderViewer({ hasNext: false });
    // Dokunmatik yüzeyin ivmeli kuyruğu: tek hareket
    for (const [delta, gap] of [[-60, 0], [-120, 16], [-40, 16], [-8, 16]]) {
      now += gap;
      fireEvent.wheel(stage, { deltaY: delta });
    }
    expect(current.onStep).toHaveBeenCalledTimes(1);
    expect(current.onStep).toHaveBeenLastCalledWith(-1);

    now += WHEEL_STEP_COOLDOWN_MS + WHEEL_GESTURE_GAP_MS;
    fireEvent.wheel(stage, { deltaY: 90, ctrlKey: true });
    now += WHEEL_STEP_COOLDOWN_MS + WHEEL_GESTURE_GAP_MS;
    fireEvent.wheel(stage, { deltaY: 90 }); // son ilan: sonraki yok
    expect(current.onStep).toHaveBeenCalledTimes(1);
  });

  it("çekmecenin üstünde tekerlek ilan değiştirmez (çekmece kayar)", () => {
    const { props: current } = renderViewer();
    fireEvent.click(button("Detaylar"));
    fireEvent.wheel(screen.getByTestId("panel"), { deltaY: 120 });
    expect(current.onStep).not.toHaveBeenCalled();
  });

  it("sonraki ilana kayarak geçiş: giden yukarı çıkar, gelen alttan girer; eski video bırakılır", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const view = renderViewer();
    await vi.waitFor(() => expect(hls.instances).toHaveLength(1));

    view.rerender(<ShortsViewer {...props({ vehicle: vehicle("c"), direction: 1, position: 3 })} />);
    expect(leavingSlide()?.className).toContain("shorts-leave-next");
    expect(leavingSlide()?.hasAttribute("inert")).toBe(true);
    expect(leavingSlide()?.querySelector("img")?.getAttribute("src")).toBe("https://video/b.jpg");
    expect(leavingSlide()?.querySelector("video")).toBeNull();
    expect(currentSlide().className).toContain("shorts-enter-next");
    expect(currentSlide().textContent).toContain("BMW Model c");
    expect(hls.instances[0].destroy).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(SLIDE_MS + 60);
    });
    expect(leavingSlide()).toBeNull();
    expect(currentSlide().className).not.toContain("shorts-enter");

    // Önceki ilana: ters yön
    view.rerender(<ShortsViewer {...props({ vehicle: vehicle("b"), direction: -1 })} />);
    expect(leavingSlide()?.className).toContain("shorts-leave-prev");
    expect(currentSlide().className).toContain("shorts-enter-prev");
  });

  it("ilk açılışta ve yönsüz değişimde kayma yok", () => {
    const view = renderViewer();
    expect(leavingSlide()).toBeNull();
    expect(currentSlide().className).not.toContain("shorts-enter");
    view.rerender(<ShortsViewer {...props({ vehicle: vehicle("x"), direction: 0 })} />);
    expect(leavingSlide()).toBeNull();
    expect(currentSlide().textContent).toContain("BMW Model x");
  });
});

describe("ShortsViewer: İlan detayı çekmecesi", () => {
  it("Detaylar ve başlık çekmeceyi açar; künye paneli oynatıcının içinde; X kapatır ve odak oynatıcıya döner", async () => {
    const { dialog } = renderViewer();
    fireEvent.click(button("Detaylar"));
    expect(drawer().dataset.open).toBe("true");
    expect(button("Detaylar").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("panel").textContent).toContain("BMW Model b");
    await waitFor(() => expect(screen.getByTestId("panel").dataset.hasContainer).toBe("true"));
    expect(screen.getByTestId("panel").dataset.commentsRequest).toBe("0");

    fireEvent.click(button("İlan detayını kapat"));
    expect(drawer().dataset.open).toBe("false");
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(document.activeElement).toBe(dialog);

    fireEvent.click(currentSlide().querySelector<HTMLButtonElement>("[data-shorts-info] h2 button")!);
    expect(drawer().dataset.open).toBe("true");
    fireEvent.click(button("Detaylar"));
    expect(drawer().dataset.open).toBe("false");
  });

  it("Yorum çekmeceyi yorumlarla açar; sonraki ilanda çekmece açık kalır, yorum isteği yinelenmez", () => {
    const view = renderViewer();
    fireEvent.click(button("Yorumlar"));
    expect(drawer().dataset.open).toBe("true");
    expect(screen.getByTestId("panel").dataset.commentsRequest).toBe("1");

    view.rerender(<ShortsViewer {...props({ vehicle: vehicle("c"), direction: 1 })} />);
    expect(drawer().dataset.open).toBe("true");
    expect(screen.getByTestId("panel").textContent).toContain("BMW Model c");
    expect(screen.getByTestId("panel").dataset.commentsRequest).toBe("0");
  });

  it("yorum sayısı sütunda", () => {
    renderViewer({ vehicle: vehicle("b", { commentsCount: 1_250 }) });
    const comments = button("Yorumlar (1250)");
    expect(comments.textContent).toBe(formatCount(1_250)); // "1,3 B"
  });
});

describe("ShortsViewer: kapatma", () => {
  it("sol üstteki geri düğmesi kapatır ve kaydırma kilidi kalkar", async () => {
    const view = renderViewer();
    fireEvent.click(button("Vitrine dön"));
    await waitFor(() => expect(view.props.onClose).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("Esc (pencerenin kapanması) kapatır; içteki pencerenin close olayı kapatmaz, içteyken ok tuşu gezinmez", async () => {
    const { props: current, dialog } = renderViewer();
    const inner = document.createElement("dialog");
    document.body.appendChild(inner);
    inner.showModal();
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(current.onStep).not.toHaveBeenCalled();
    inner.close();
    inner.remove();

    // React, içteki pencerenin close olayını bileşen ağacında dışa da iletir
    fireEvent(dialog.querySelector("video")!, new Event("close", { bubbles: true }));
    expect(current.onClose).not.toHaveBeenCalled();

    act(() => dialog.close());
    await waitFor(() => expect(current.onClose).toHaveBeenCalledTimes(1));
  });
});
