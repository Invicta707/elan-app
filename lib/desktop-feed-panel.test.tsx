// @vitest-environment happy-dom
//
// Masaüstü yan panel (1024 px ve üstü): ekrandaki ilanın fiyatı, özellikleri,
// satıcı kartı, WhatsApp / Ara / Mesaj ve yorumlar; iskelet ve boş durum;
// akıştaki "Yorum" düğmesiyle yorumlara odaklanma.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("./supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock("../app/fonts", () => ({ displayFont: { variable: "" }, bodyFont: { variable: "" } }));
vi.mock("./auth", () => ({ useSupabaseSession: () => ({ session: null, isLoading: false }) }));
vi.mock("./use-my-profile", () => ({ useMyProfile: () => ({ profile: null, loading: false, failed: false }) }));
vi.mock("../components/AuthGatedLink", () => ({ AuthModalPortal: () => <div>giriş penceresi</div> }));
vi.mock("../components/profile/UsernameSheet", () => ({ default: () => null }));

const seller = vi.hoisted(() => ({
  profile: { id: "seller-1", username: "nihad", displayName: null, avatarUrl: null, isFollowing: false } as null | {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    isFollowing: boolean;
  },
}));
vi.mock("./use-follow", () => ({
  useSellerProfile: () => seller.profile,
  useFollow: () => ({
    viewerId: null,
    sessionLoading: false,
    following: false,
    followers: null,
    pending: false,
    error: null,
    isSelf: false,
    toggle: vi.fn(),
  }),
}));

const feedApi = vi.hoisted(() => ({
  fetchVehicleDetails: vi.fn(),
  getSellerPhone: vi.fn(),
  getSellerWhatsAppUrl: vi.fn(),
}));
vi.mock("./feed", () => feedApi);

import DesktopFeedPanel from "../components/feed/DesktopFeedPanel";
import type { FeedVehicle } from "./feed";
import { resetCommentCounts, setCommentCount } from "./use-comment-counts";

const vehicle: FeedVehicle = {
  id: "11111111-1111-4111-8111-111111111111",
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
  paintedPartsCount: 2,
  changedPartsCount: 0,
  hlsUrl: "https://x/v.m3u8",
  thumbnailUrl: null,
  commentsCount: 1,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  seller.profile = { id: "seller-1", username: "nihad", displayName: null, avatarUrl: null, isFollowing: false };
  feedApi.fetchVehicleDetails.mockReset().mockResolvedValue({ bodyType: "sedan", description: "Hasar boya yok.", photoUrls: [] });
  feedApi.getSellerPhone.mockReset().mockResolvedValue("905445673430");
  feedApi.getSellerWhatsAppUrl.mockReset().mockResolvedValue(null);
  fetchMock = vi.fn(async () =>
    json({
      total: 1,
      comments: [
        {
          id: "c1",
          userId: "u1",
          content: "Takas olur mu?",
          createdAt: new Date().toISOString(),
          username: "alici",
          displayName: null,
          avatarUrl: null,
          isSeller: false,
          isMine: false,
          canDelete: false,
        },
      ],
      nextCursor: null,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetCommentCounts();
});

describe("DesktopFeedPanel", () => {
  it("fiyat, özellikler, satıcı, açıklama ve yorumlar doğrudan listelenir", async () => {
    render(<DesktopFeedPanel vehicle={vehicle} focusRequest={0} />);
    expect(screen.getByRole("heading", { name: "BMW 5 Serisi" })).toBeTruthy();
    expect(screen.getByText("2013 · 100.000 km · Isparta")).toBeTruthy();
    expect(screen.getByText(/2\.000\.000/)).toBeTruthy();
    expect(screen.getByText("Dizel")).toBeTruthy();
    expect(screen.getByText("Otomatik")).toBeTruthy();
    expect(screen.getByText("2 parça boyalı")).toBeTruthy();
    expect(screen.getByRole("link", { name: "İlan sayfasını aç" }).getAttribute("href")).toBe(`/vehicles/${vehicle.id}`);
    expect(screen.getByText("@nihad")).toBeTruthy();
    expect(screen.getByRole("button", { name: "@nihad adlı kullanıcıyı takip et" })).toBeTruthy();

    expect(await screen.findByText("Hasar boya yok.")).toBeTruthy();
    expect(screen.getByText("Sedan")).toBeTruthy();
    // Yorumlar pencere açmadan listelenir; yazma yerine misafirde giriş düğmesi
    expect(await screen.findByText("Takas olur mu?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "@alici yorumunu şikayet et" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yorum yapmak için giriş yap" })).toBeTruthy();
    expect(document.querySelector("dialog")).toBeNull();
    expect(feedApi.fetchVehicleDetails).toHaveBeenCalledWith(vehicle.id);
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain(`/api/vehicles/${vehicle.id}/comments`);
  });

  it("Ara: numara yalnızca basınca istenir, arama bağlantısıyla gösterilir", async () => {
    render(<DesktopFeedPanel vehicle={vehicle} focusRequest={0} />);
    expect(feedApi.getSellerPhone).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Satıcıyı ara: numarayı göster" }));
    });
    const call = screen.getByRole("link", { name: "0544 567 34 30 numarasını ara" });
    expect(call.getAttribute("href")).toBe("tel:+905445673430");
    expect(feedApi.getSellerPhone).toHaveBeenCalledWith(vehicle.id);
  });

  it("numara yoksa ya da alınamazsa açıklama", async () => {
    feedApi.getSellerPhone.mockResolvedValueOnce(null);
    render(<DesktopFeedPanel vehicle={vehicle} focusRequest={0} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Satıcıyı ara: numarayı göster" }));
    });
    expect(screen.getByText("Bu ilan için telefon numarası bulunamadı.")).toBeTruthy();
  });

  it("yorum sayısı ortak depodan başlar ve panelde yazılan sayıyla güncellenir", async () => {
    setCommentCount(vehicle.id, 5);
    render(<DesktopFeedPanel vehicle={vehicle} focusRequest={0} />);
    expect(screen.getByRole("heading", { name: /Yorumlar/ }).textContent).toContain("5");
    // Sunucudaki gerçek sayı gelince (1) depo da güncellenir
    await screen.findByText("Takas olur mu?");
    expect(screen.getByRole("heading", { name: /Yorumlar/ }).textContent).toContain("1");
  });

  it("akıştaki Yorum düğmesi: yorumlara kaydırır, (misafirde) giriş düğmesine odaklanır", async () => {
    const original = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const { rerender } = render(<DesktopFeedPanel vehicle={vehicle} focusRequest={0} />);
      await screen.findByText("Takas olur mu?");
      expect(scrollIntoView).not.toHaveBeenCalled();
      rerender(<DesktopFeedPanel vehicle={vehicle} focusRequest={1} />);
      expect(scrollIntoView).toHaveBeenCalled();
      expect(document.activeElement?.textContent).toBe("Yorum yapmak için giriş yap");
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("akış yüklenirken iskelet, gösterilecek ilan yoksa boş durum; veri istenmez", () => {
    const { rerender } = render(<DesktopFeedPanel vehicle={undefined} focusRequest={0} />);
    expect(screen.queryByRole("heading")).toBeNull();
    rerender(<DesktopFeedPanel vehicle={null} focusRequest={0} />);
    expect(screen.getByText("İlan ayrıntıları burada")).toBeTruthy();
    expect(feedApi.fetchVehicleDetails).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
