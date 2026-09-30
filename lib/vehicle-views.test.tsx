// @vitest-environment happy-dom
//
// İzlenme sayacı, istemci tarafı (lib/vehicle-views.ts) ve rozetin yerleri:
// biçim ("450", "1,2B", "1,1M"), oturumda ilan başına tek sayım
// (sessionStorage; depolama yoksa bellek), RPC çağrısı ve ortak sayı deposu.
// Ne zaman sayılır: masaüstü vitrin kartının fareyle önizlemesi hiç saymaz;
// Shorts oynatıcısı video oynayınca sayar; mobil akış kartı ekrandaki video
// 2 sn kesintisiz oynayınca sayar. Mobil duraklatma işareti masaüstüyle aynı
// sade göz.

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("./supabase", () => ({ supabase: { rpc, auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock("../app/fonts", () => ({ displayFont: { variable: "" }, bodyFont: { variable: "" } }));
vi.mock("./auth", () => ({ useSupabaseSession: () => ({ session: null, isLoading: false }) }));
vi.mock("./use-my-profile", () => ({ useMyProfile: () => ({ profile: null, loading: false, failed: false }) }));
vi.mock("./use-favorites", () => ({ useFavorites: () => ({ ids: [] }), toggleFavorite: vi.fn() }));
vi.mock("../components/AuthGatedLink", () => ({ AuthModalPortal: () => null }));
vi.mock("./use-follow", () => ({
  primeSellerProfiles: vi.fn(async () => {}),
  useSellerProfile: () => ({ id: "seller-1", username: "nihad", displayName: null, avatarUrl: null, isFollowing: false }),
  useFollow: () => ({ viewerId: null, sessionLoading: false, following: false, followers: null, pending: false, error: null, isSelf: false, toggle: vi.fn() }),
}));
vi.mock("./feed", () => ({ getSellerWhatsAppUrl: vi.fn(async () => null), fetchVehicleDetails: vi.fn(async () => ({ bodyType: null, description: null, photoUrls: [] })) }));
vi.mock("../components/feed/DesktopFeedPanel", () => ({ default: () => <div data-testid="panel" /> }));
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
  }
  return { default: FakeHls };
});

import VideoCard from "../components/VideoCard";
import PortalCard from "../components/portal/PortalCard";
import PortalPhotoCard from "../components/portal/PortalPhotoCard";
import ShortsViewer from "../components/portal/ShortsViewer";
import type { FeedVehicle } from "./feed";
import { PREVIEW_DELAY_MS, type PortalVehicle } from "./portal";
import {
  MOBILE_VIEW_THRESHOLD_MS,
  VIEWED_STORAGE_KEY,
  formatViewCount,
  hasViewed,
  recordVehicleView,
  resetVehicleViews,
  setViewCount,
  useViewCount,
  viewCountLabel,
} from "./vehicle-views";

const ID = "11111111-1111-4111-8111-111111111111";

const portalVehicle = (overrides: Partial<PortalVehicle> = {}): PortalVehicle => ({
  id: ID,
  sellerId: "seller-1",
  brandName: "BMW",
  modelName: "5 Serisi",
  year: 2013,
  price: 2_000_000,
  currency: "TRY",
  mileageKm: 100_000,
  fuelType: "dizel",
  transmission: "otomatik",
  city: "Isparta",
  tramerAmount: 0,
  hasHeavyDamage: false,
  paintedPartsCount: 0,
  changedPartsCount: 0,
  commentsCount: 0,
  hlsUrl: "https://video/v.m3u8",
  posterUrl: "https://video/v.jpg",
  photoUrl: "https://photo/p.jpeg",
  isTest: false,
  viewsCount: 450,
  createdAt: "2026-09-27T10:00:00+00:00",
  ...overrides,
});

const feedVehicle: FeedVehicle = {
  id: ID,
  sellerId: "seller-1",
  brandName: "BMW",
  modelName: "5 Serisi",
  year: 2013,
  price: 2_000_000,
  currency: "TRY",
  mileageKm: 100_000,
  fuelType: "dizel",
  transmission: "otomatik",
  city: "Isparta",
  tramerAmount: 0,
  hasHeavyDamage: false,
  paintedPartsCount: 0,
  changedPartsCount: 0,
  hlsUrl: "https://video/v.m3u8",
  thumbnailUrl: null,
  commentsCount: 0,
  viewsCount: 1_250,
};

beforeEach(() => {
  resetVehicleViews();
  rpc.mockReset().mockResolvedValue({ data: 451, error: null });
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

describe("formatViewCount", () => {
  it("0–999 olduğu gibi, binler B, milyonlar M; ondalık virgül, aşağı yuvarlama", () => {
    expect([0, 7, 450, 999].map(formatViewCount)).toEqual(["0", "7", "450", "999"]);
    expect([1000, 1200, 1250, 1999, 12_345, 999_999].map(formatViewCount)).toEqual(["1B", "1,2B", "1,2B", "1,9B", "12,3B", "999,9B"]);
    expect([1_000_000, 1_150_000, 25_900_000].map(formatViewCount)).toEqual(["1M", "1,1M", "25,9M"]);
    expect([-5, Number.NaN, 3.9].map(formatViewCount)).toEqual(["0", "0", "3"]);
    expect(viewCountLabel(1234)).toBe("1.234 izlenme");
  });
});

describe("recordVehicleView: oturumda ilan başına bir kez", () => {
  it("ilk izlenme RPC'yi çağırır ve yeni sayıyı döner; ikincisi istek atmaz", async () => {
    expect(await recordVehicleView(ID)).toBe(451);
    expect(rpc).toHaveBeenCalledWith("increment_vehicle_view", { target_vehicle_id: ID });
    expect(hasViewed(ID)).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(VIEWED_STORAGE_KEY) ?? "[]")).toEqual([ID]);
    expect(await recordVehicleView(ID)).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("aynı anda iki çağrı (oynat/duraklat) tek istek", async () => {
    await Promise.all([recordVehicleView(ID), recordVehicleView(ID)]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("ağ hatasında işaret kalkar, sonraki izlemede yeniden denenir", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { message: "ağ" } });
    expect(await recordVehicleView(ID)).toBeNull();
    expect(hasViewed(ID)).toBe(false);
    expect(await recordVehicleView(ID)).toBe(451);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("yayında olmayan ilan (null) sayılmaz ve oturumda yeniden denenmez", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await recordVehicleView(ID)).toBeNull();
    expect(await recordVehicleView(ID)).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("sessionStorage yoksa (gizli pencere) sayfa ömrü boyunca bellekte tutulur", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    await recordVehicleView(ID);
    await recordVehicleView(ID);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rozet deposu: sayılan ilanın yeni sayısı; listeden gelen daha büyükse o", async () => {
    const { result, rerender } = renderHook(({ fallback }) => useViewCount(ID, fallback), { initialProps: { fallback: 450 } });
    expect(result.current).toBe(450);
    await act(async () => {
      await recordVehicleView(ID);
    });
    expect(result.current).toBe(451);
    rerender({ fallback: 460 });
    expect(result.current).toBe(460);
    act(() => setViewCount(ID, 470));
    expect(result.current).toBe(470);
  });
});

describe("masaüstü vitrin kartı: rozet ve önizleme", () => {
  const now = new Date("2026-09-28T12:00:00");

  it("izlenme rozeti sol üstte, Test ilanı etiketinin altında; görselli kartta da", () => {
    const { container } = render(
      <PortalCard vehicle={portalVehicle({ isTest: true })} eager={false} previewEnabled onOpen={vi.fn()} now={now} />,
    );
    const badge = container.querySelector<HTMLElement>("[data-view-count]")!;
    expect(badge.textContent).toContain("450");
    expect(badge.textContent).toContain("450 izlenme");
    expect(badge.className).toMatch(/rounded-full/);
    const column = badge.parentElement!;
    expect(column.className).toContain("left-2 top-2");
    expect(column.firstElementChild?.textContent).toBe("Test ilanı");
    expect(column.lastElementChild).toBe(badge);
    cleanup();

    const photo = render(<PortalPhotoCard vehicle={portalVehicle({ viewsCount: 1_250 })} eager={false} onOpen={vi.fn()} now={now} />);
    expect(photo.container.querySelector("[data-view-count]")?.textContent).toContain("1,2B");
  });

  it("fareyle önizleme oynasa da izlenme sayılmaz", async () => {
    const { container } = render(<PortalCard vehicle={portalVehicle()} eager={false} previewEnabled onOpen={vi.fn()} now={now} />);
    const link = container.querySelector("a")!;
    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    await waitFor(() => expect(container.querySelector("[data-preview-video]")).not.toBeNull(), { timeout: PREVIEW_DELAY_MS + 500 });
    const preview = container.querySelector<HTMLVideoElement>("[data-preview-video]")!;
    fireEvent.playing(preview);
    // Önizleme döngüsü birkaç kez döner
    for (let i = 0; i < 3; i += 1) fireEvent.timeUpdate(preview);
    await new Promise((resolve) => setTimeout(resolve, 50));
    fireEvent.pointerLeave(link, { pointerType: "mouse" });
    expect(rpc).not.toHaveBeenCalled();
    expect(hasViewed(ID)).toBe(false);
  });
});

describe("Shorts oynatıcısı: oynayınca sayar", () => {
  function renderViewer(vehicle = portalVehicle()) {
    return render(
      <ShortsViewer
        vehicle={vehicle}
        direction={0}
        hasPrev={false}
        hasNext={false}
        loadingNext={false}
        neighbors={{ prev: null, next: null }}
        onStep={vi.fn()}
        onClose={vi.fn()}
      />,
    );
  }

  it("açılınca değil, video oynamaya başlayınca bir kez sayar; rozet yeni sayıyı gösterir", async () => {
    renderViewer();
    const info = document.querySelector("[data-shorts-slide='current'] [data-shorts-info]")!;
    expect(info.querySelector("[data-view-count]")?.textContent).toContain("450");
    expect(rpc).not.toHaveBeenCalled();

    const video = document.querySelector<HTMLVideoElement>("[data-shorts-slide='current'] video")!;
    fireEvent.playing(video);
    await waitFor(() => expect(info.querySelector("[data-view-count]")?.textContent).toContain("451"));
    // Duraklatıp yeniden oynatmak, döngü: yeniden sayılmaz
    fireEvent.pause(video);
    fireEvent.playing(video);
    fireEvent.playing(video);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("increment_vehicle_view", { target_vehicle_id: ID });
  });

  it("aynı oturumda oynatıcı yeniden açılınca sayılmaz", async () => {
    const first = renderViewer();
    fireEvent.playing(document.querySelector("[data-shorts-slide='current'] video")!);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    first.unmount();
    renderViewer();
    fireEvent.playing(document.querySelector("[data-shorts-slide='current'] video")!);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("mobil akış kartı: 2 sn kesintisiz oynayınca sayar", () => {
  function renderCard(isActive = true) {
    const view = render(<VideoCard vehicle={feedVehicle} isActive={isActive} shouldLoad={false} />);
    return { ...view, video: view.container.querySelector("video")! };
  }

  it("ekrandaki video 2 sn oynayınca bir kez sayılır; döngüde yeniden sayılmaz", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { video } = renderCard();
    fireEvent.playing(video);
    act(() => {
      vi.advanceTimersByTime(MOBILE_VIEW_THRESHOLD_MS - 1);
    });
    expect(rpc).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("increment_vehicle_view", { target_vehicle_id: ID });

    // Döngü / duraklat-oynat: süre dolsa da ikinci istek yok
    fireEvent.pause(video);
    fireEvent.playing(video);
    await act(async () => {
      vi.advanceTimersByTime(MOBILE_VIEW_THRESHOLD_MS * 2);
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("2 sn dolmadan duraklatma ya da tampon beklemesi süreyi baştan başlatır", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { video } = renderCard();
    fireEvent.playing(video);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    fireEvent.pause(video);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rpc).not.toHaveBeenCalled();

    fireEvent.playing(video);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    fireEvent.waiting(video);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rpc).not.toHaveBeenCalled();

    fireEvent.playing(video);
    await act(async () => {
      vi.advanceTimersByTime(MOBILE_VIEW_THRESHOLD_MS);
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("ekranda olmayan (aktif olmayan) kart saymaz; kaydırıp geçince süre iptal", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const inactive = renderCard(false);
    fireEvent.playing(inactive.video);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rpc).not.toHaveBeenCalled();
    inactive.unmount();

    const view = renderCard(true);
    fireEvent.playing(view.video);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    view.rerender(<VideoCard vehicle={feedVehicle} isActive={false} shouldLoad={false} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("izlenme rozeti @kullanıcı_adı etiketinin hemen sağında; alt satırda (fiyat, Yıl / KM / İl) yok", () => {
    renderCard(false);
    const facts = screen.getByRole("list", { name: "Fiyat ve araç özellikleri" });
    expect(facts.querySelector("[data-view-count]")).toBeNull();
    const seller = screen.getByRole("link", { name: "@nihad vitrini" });
    const badge = seller.nextElementSibling as HTMLElement;
    expect(badge.dataset.viewCount).toBe("1250");
    expect(badge.textContent).toContain("1,2B");
  });

  it("duraklatma işareti masaüstüyle aynı sade göz: daire, kenarlık, buzlu zemin yok", () => {
    const { container } = renderCard(true);
    const mark = container.querySelector<HTMLElement>("[data-paused-mark]")!;
    expect(mark.dataset.pausedMark).toBe("visible");
    expect(mark.className).not.toMatch(/rounded-full|bg-black|ring-|backdrop-blur/);
    const svg = mark.querySelector("svg")!;
    expect(svg.getAttribute("class")).toContain("text-white/85");
    expect(svg.querySelectorAll("polygon")).toHaveLength(1);
    expect(svg.querySelectorAll("circle, rect")).toHaveLength(0);
  });
});
