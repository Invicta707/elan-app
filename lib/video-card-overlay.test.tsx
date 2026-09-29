// @vitest-environment happy-dom
//
// Akış kartının mobil bilgi şeridi (< 1024 px): yalnızca satıcı etiketi, tek
// satır başlık, fiyat ve Yıl / KM / İl hapları; yakıt, vites ve ekspertiz
// detaylara taşındı. Sağ sütunda WhatsApp dahil ince etiketli simgeler.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ImgHTMLAttributes } from "react";
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
vi.mock("./supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock("../app/fonts", () => ({ displayFont: { variable: "" }, bodyFont: { variable: "" } }));
vi.mock("./auth", () => ({ useSupabaseSession: () => ({ session: null, isLoading: false }) }));
vi.mock("./use-my-profile", () => ({ useMyProfile: () => ({ profile: null, loading: false, failed: false }) }));
vi.mock("./use-favorites", () => ({ useFavorites: () => ({ ids: [] }), toggleFavorite: vi.fn() }));
vi.mock("../components/AuthGatedLink", () => ({ AuthModalPortal: () => null }));
vi.mock("./use-follow", () => ({
  useSellerProfile: () => ({ id: "seller-1", username: "nihad", displayName: null, avatarUrl: null, isFollowing: false }),
  useFollow: () => ({ viewerId: null, sessionLoading: false, following: false, followers: null, pending: false, error: null, isSelf: false, toggle: vi.fn() }),
}));
const feedApi = vi.hoisted(() => ({
  getSellerWhatsAppUrl: vi.fn(),
  fetchVehicleDetails: vi.fn(async () => ({ bodyType: null, description: null, photoUrls: [] })),
}));
vi.mock("./feed", () => feedApi);

import VideoCard from "../components/VideoCard";
import type { FeedVehicle } from "./feed";
import { resetSound, setSoundMuted } from "./sound";
import { toggleFavorite } from "./use-favorites";

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
  commentsCount: 3,
};

function renderCard(overrides: Partial<FeedVehicle> = {}) {
  return render(<VideoCard vehicle={{ ...vehicle, ...overrides }} isActive={false} shouldLoad={false} />);
}

beforeEach(() => {
  feedApi.getSellerWhatsAppUrl.mockReset().mockResolvedValue(null);
  // Kartlar sessiz (ses düğmesi "Sesi aç"): ses tercihi kapalı
  setSoundMuted(true);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetSound();
});

describe("mobil bilgi şeridi", () => {
  it("satıcı etiketi, tek satır başlık, fiyat ve Yıl / KM / İl hapları", () => {
    renderCard();
    expect(screen.getByRole("link", { name: "@nihad vitrini" })).toBeTruthy();
    const title = screen.getByRole("heading", { name: "BMW 5 Serisi" });
    expect(within(title).getByRole("button").className).toContain("truncate");
    const facts = screen.getByRole("list", { name: "Fiyat ve araç özellikleri" });
    // Alt satır tek satır: fiyat + Yıl / KM / İl (izlenme rozeti satıcı etiketinin yanında)
    expect(within(facts).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "₺2.000.000 TL",
      "2013",
      "100.000 km",
      "Isparta",
    ]);
  });

  it("yakıt, vites ve ekspertiz kartta yok (detaylarda); ağır hasar küçük kırmızı hapta", () => {
    renderCard({ hasHeavyDamage: true });
    const article = screen.getByRole("article");
    for (const text of ["Dizel", "Otomatik", "2 parça boyalı", "Değişensiz"]) {
      expect(within(article).queryByText(text)).toBeNull();
    }
    expect(within(screen.getByRole("list", { name: "Fiyat ve araç özellikleri" })).getByText("Ağır hasar")).toBeTruthy();
  });

  it("ekspertiz detay penceresinde", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "İlan detayları ve fotoğraflar" }));
    expect(await screen.findByRole("heading", { name: "Ekspertiz" })).toBeTruthy();
    expect(screen.getByText("2 parça boyalı")).toBeTruthy();
  });
});

describe("sağ sütun", () => {
  it("Beğen, Yorum, Paylaş, WhatsApp, Detaylar, Bildir ve Ses; etiketler ince ve 11,5 px", () => {
    renderCard();
    for (const name of ["Beğen, favorilere ekle", "Yorumlar (3)", "İlanı paylaş", "WhatsApp'tan yaz", "İlan detayları ve fotoğraflar", "İlanı bildir", "Sesi aç"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    // Masaüstü Shorts sütunuyla aynı etiket; eski "Favori" yazısı kalmadı
    const like = screen.getByRole("button", { name: "Beğen, favorilere ekle" });
    expect(like.textContent).toBe("Beğen");
    expect(within(screen.getByRole("article")).queryByText("Favori")).toBeNull();
    const label = within(like).getByText("Beğen");
    expect(label.className).toContain("text-[11.5px]");
    expect(label.className).toContain("font-medium");
    // Simge 26 px, dokunma alanı 44 px genişliğinde
    expect(screen.getByRole("button", { name: "Yorumlar (3)" }).className).toContain("w-11");
    expect(screen.getByRole("button", { name: "Yorumlar (3)" }).querySelector("svg")?.getAttribute("class")).toContain("h-[26px]");
  });

  it("Beğen yine favorilere ekler (işlev aynı)", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Beğen, favorilere ekle" }));
    expect(toggleFavorite).toHaveBeenCalledWith(vehicle.id);
  });

  it("WhatsApp sütundan açılır; numara yoksa bilgi şeridinde uyarı", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp'tan yaz" }));
    expect(feedApi.getSellerWhatsAppUrl).toHaveBeenCalledWith(expect.objectContaining({ id: vehicle.id }));
    expect(await screen.findByText("Bu ilan için WhatsApp numarası bulunamadı.")).toBeTruthy();
  });
});

describe("test ilanı", () => {
  it("deneme ilanında bilgi şeridinde \"Test ilanı\" hapı; gerçek ilanda yok", () => {
    renderCard({ isTest: true });
    const facts = screen.getByRole("list", { name: "Fiyat ve araç özellikleri" });
    expect(within(facts).getAllByRole("listitem").map((item) => item.textContent)).toContain("Test ilanı");
    cleanup();
    renderCard();
    expect(screen.queryByText("Test ilanı")).toBeNull();
  });
});
