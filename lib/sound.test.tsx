// @vitest-environment happy-dom
//
// Küresel ses durumu (lib/sound.ts): kalıcı tercih (localStorage), tarayıcı
// sesli otomatik oynatmayı reddedince sessiz oynatma + "Sesi aç" rozeti, ilk
// dokunuş/tuşla sesin jestin içinde açılması (videoyu durdurmadan). Mobil akış
// kartı ve masaüstü Shorts oynatıcısı aynı depoyu kullanır.

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
vi.mock("./supabase", () => ({ supabase: { rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock("../app/fonts", () => ({ displayFont: { variable: "" }, bodyFont: { variable: "" } }));
vi.mock("./auth", () => ({ useSupabaseSession: () => ({ session: null, isLoading: false }) }));
vi.mock("./use-my-profile", () => ({ useMyProfile: () => ({ profile: null, loading: false, failed: false }) }));
vi.mock("./use-favorites", () => ({ useFavorites: () => ({ ids: [] }), toggleFavorite: vi.fn() }));
vi.mock("../components/AuthGatedLink", () => ({ AuthModalPortal: () => null }));
vi.mock("./use-follow", () => ({
  primeSellerProfiles: vi.fn(async () => {}),
  useSellerProfile: () => null,
  useFollow: () => ({ viewerId: null, sessionLoading: false, following: false, followers: null, pending: false, error: null, isSelf: false, toggle: vi.fn() }),
}));
vi.mock("./feed", () => ({ getSellerWhatsAppUrl: vi.fn(async () => null), fetchVehicleDetails: vi.fn(async () => ({ bodyType: null, description: null, photoUrls: [] })) }));
vi.mock("../components/feed/DesktopFeedPanel", () => ({ default: () => null }));
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
import ShortsViewer from "../components/portal/ShortsViewer";
import type { FeedVehicle } from "./feed";
import type { PortalVehicle } from "./portal";
import { SOUND_STORAGE_KEY, isUnlockEvent, markSoundBlocked, registerSoundTarget, resetSound, setSoundMuted, useSound } from "./sound";

const ID = "11111111-1111-4111-8111-111111111111";

const feedVehicle: FeedVehicle = {
  id: ID,
  sellerId: null,
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
};

const portalVehicle: PortalVehicle = {
  ...feedVehicle,
  posterUrl: "https://video/v.jpg",
  photoUrl: null,
  isTest: false,
  createdAt: null,
};

/** Tarayıcı sesli oynatmayı reddeder (jest yok); sessiz oynatmaya izin verir */
function blockUnmutedPlay() {
  let allowSound = false;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    if (!this.muted && !allowSound) return Promise.reject(new DOMException("blocked", "NotAllowedError"));
    return Promise.resolve();
  });
  return { allow: () => (allowSound = true) };
}

beforeEach(() => {
  localStorage.clear();
  resetSound();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetSound();
});

describe("ses deposu", () => {
  it("varsayılan ses açık; ses düğmesi tercihi kalıcı yazar, sayfaya yeniden gelişte aynı", () => {
    const { result } = renderHook(() => useSound());
    expect(result.current).toMatchObject({ muted: false, blocked: false });
    act(() => result.current.setMuted(true));
    expect(result.current.muted).toBe(true);
    expect(localStorage.getItem(SOUND_STORAGE_KEY)).toBe("off");

    // Yeni sayfa (modül durumu sıfır): tercih depodan okunur
    resetSound();
    const again = renderHook(() => useSound());
    expect(again.result.current.muted).toBe(true);
    act(() => again.result.current.setMuted(false));
    expect(localStorage.getItem(SOUND_STORAGE_KEY)).toBe("on");
  });

  it("tarayıcı engeli: sessiz ve rozet; ilk tık ekrandaki videonun sesini jestin içinde açar, tercih değişmez", () => {
    const { result } = renderHook(() => useSound());
    const video = document.createElement("video");
    const play = vi.spyOn(video, "play").mockResolvedValue(undefined);
    Object.defineProperty(video, "paused", { value: true, configurable: true });
    video.muted = true;
    const unregister = registerSoundTarget(video);

    act(() => markSoundBlocked());
    expect(result.current).toMatchObject({ muted: true, blocked: true });

    const click = new MouseEvent("click", { bubbles: true });
    act(() => {
      document.body.dispatchEvent(click);
    });
    expect(video.muted).toBe(false);
    expect(play).toHaveBeenCalled();
    expect(isUnlockEvent(click)).toBe(true);
    expect(result.current).toMatchObject({ muted: false, blocked: false });
    expect(localStorage.getItem(SOUND_STORAGE_KEY)).toBeNull();

    // Dinleyici kalktı: sonraki tıklama bir şey yapmaz
    const second = new MouseEvent("click", { bubbles: true });
    document.body.dispatchEvent(second);
    expect(isUnlockEvent(second)).toBe(false);
    unregister();
  });

  it("tuşla da açılır; tercih kapalıyken engel yok sayılır (rozet yok)", () => {
    const { result } = renderHook(() => useSound());
    act(() => markSoundBlocked());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });
    expect(result.current.blocked).toBe(false);

    act(() => setSoundMuted(true));
    act(() => markSoundBlocked());
    expect(result.current).toMatchObject({ muted: true, blocked: false });
  });

  it("depolama yoksa (gizli pencere) tercih sayfa ömrü boyunca geçerli", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const { result } = renderHook(() => useSound());
    expect(result.current.muted).toBe(false);
    act(() => result.current.setMuted(true));
    expect(result.current.muted).toBe(true);
  });
});

describe("mobil akış kartı", () => {
  const renderCard = () => {
    const view = render(<VideoCard vehicle={feedVehicle} isActive shouldLoad={false} />);
    return { ...view, video: view.container.querySelector("video")! };
  };

  it("ses açık tercihle sesli başlar; ses düğmesi kapatınca sonraki kartlar da sessiz", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const first = renderCard();
    await waitFor(() => expect(play).toHaveBeenCalled());
    expect(first.video.muted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Sesi kapat" }));
    expect(first.video.muted).toBe(true);
    first.unmount();

    const next = renderCard();
    expect(next.video.muted).toBe(true);
    expect(screen.getByRole("button", { name: "Sesi aç" })).toBeTruthy();
    expect(next.container.querySelector("[data-unmute-pill]")).toBeNull();
  });

  it("tarayıcı sesli oynatmayı reddederse sessiz oynar ve 'Sesi aç' rozeti çıkar; ekrana ilk dokunuş sesi açar, videoyu durdurmaz", async () => {
    const browser = blockUnmutedPlay();
    const { container, video } = renderCard();
    await waitFor(() => expect(container.querySelector("[data-unmute-pill]")).not.toBeNull());
    expect(video.muted).toBe(true);
    // Rozet ve sağ sütundaki ses düğmesi ikisi de "Sesi aç"
    expect(screen.getAllByRole("button", { name: "Sesi aç" })).toHaveLength(2);

    browser.allow();
    Object.defineProperty(video, "paused", { value: false, configurable: true });
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Videoyu/ }));
    expect(video.muted).toBe(false);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    expect(container.querySelector("[data-unmute-pill]")).toBeNull();
    expect(screen.getByRole("button", { name: "Sesi kapat" })).toBeTruthy();
  });

  it("'Sesi aç' rozetine dokunmak da açar", async () => {
    const browser = blockUnmutedPlay();
    const { container, video } = renderCard();
    await waitFor(() => expect(container.querySelector("[data-unmute-pill]")).not.toBeNull());
    browser.allow();
    fireEvent.click(container.querySelector("[data-unmute-pill]")!);
    expect(video.muted).toBe(false);
    expect(container.querySelector("[data-unmute-pill]")).toBeNull();
  });

  it("engel kalktıktan sonraki dokunuş normal: videoyu durdurur", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const { video } = renderCard();
    Object.defineProperty(video, "paused", { value: false, configurable: true });
    fireEvent.click(screen.getByRole("button", { name: /Videoyu/ }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });
});

describe("masaüstü Shorts oynatıcısı", () => {
  function renderViewer() {
    return render(
      <ShortsViewer
        vehicle={portalVehicle}
        direction={0}
        position={1}
        total={1}
        moreAvailable={false}
        hasPrev={false}
        hasNext={false}
        loadingNext={false}
        neighbors={{ prev: null, next: null }}
        onStep={vi.fn()}
        onClose={vi.fn()}
      />,
    );
  }

  it("karta tıklayınca sesli başlar (mobille aynı tercih)", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    renderViewer();
    await waitFor(() => expect(play).toHaveBeenCalled());
    expect(document.querySelector<HTMLVideoElement>("[data-shorts-slide='current'] video")!.muted).toBe(false);
    expect(document.querySelector("[data-unmute-pill]")).toBeNull();
  });

  it("bağlantıyla gelip engellenince sol üstte 'Sesi aç'; boşluk tuşu sesi açar ama videoyu durdurmaz", async () => {
    const browser = blockUnmutedPlay();
    renderViewer();
    await waitFor(() => expect(document.querySelector("[data-unmute-pill]")).not.toBeNull());
    const video = document.querySelector<HTMLVideoElement>("[data-shorts-slide='current'] video")!;
    expect(video.muted).toBe(true);

    browser.allow();
    Object.defineProperty(video, "paused", { value: false, configurable: true });
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    fireEvent.keyDown(document.querySelector("[data-shorts-viewer]")!, { key: " " });
    expect(video.muted).toBe(false);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    expect(document.querySelector("[data-unmute-pill]")).toBeNull();
  });
});
