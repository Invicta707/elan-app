// Okunabilir ilan adresleri (lib/vehicle-slug.ts):
//   * eski /vehicles/<id> → 301 /ilan/<slug>-<id> (app/vehicles/[id]/route.ts)
//   * /ilan/[slug]: eksik ya da eski slug → kalıcı yönlendirme, kimliksiz adres
//     → 404, doğru adreste JSON-LD (app/ilan/[slug]/page.tsx)
//   * /?v=<id>: canonical ilanın sayfası (app/page.tsx generateMetadata)

import type { AnchorHTMLAttributes, ImgHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT 308 ${path}`);
  }),
}));
vi.mock("next/navigation", () => nav);
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
vi.mock("../app/fonts", () => ({ displayFont: { variable: "" }, bodyFont: { variable: "" } }));
vi.mock("../components/FavoriteButton", () => ({ default: () => null }));
vi.mock("../components/ReportButton", () => ({ default: () => null }));
vi.mock("../components/social/SellerCard", () => ({ default: () => null }));
vi.mock("../components/vehicle/BackButton", () => ({ default: () => null }));
vi.mock("../components/vehicle/VehiclePageClient", () => ({
  VehiclePageGallery: () => null,
  VehiclePageActions: ({ sharePath }: { sharePath: string }) => <div data-share-path={sharePath} />,
}));
vi.mock("../components/HomeFeed", () => ({ default: () => null }));
vi.mock("./follows", () => ({ fetchSellerProfiles: vi.fn(async () => []) }));

const pages = vi.hoisted(() => ({ fetchVehiclePage: vi.fn() }));
vi.mock("./vehicle-page", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vehicle-page")>();
  return { ...actual, fetchVehiclePage: pages.fetchVehiclePage };
});

// fetchListingPath gerçek; yalnızca Supabase taklit
const db = vi.hoisted(() => ({ row: null as unknown, error: null as unknown, selects: [] as string[] }));
vi.mock("./supabase", () => ({
  supabase: {
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = (columns: string) => {
        db.selects.push(columns);
        return builder;
      };
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({ data: db.error ? null : db.row, error: db.error });
      return builder;
    },
  },
}));

import VehiclePage, { generateMetadata as listingMetadata } from "../app/ilan/[slug]/page";
import { generateMetadata as homeMetadata } from "../app/page";
import { GET, HEAD } from "../app/vehicles/[id]/route";
import type { VehiclePageData } from "./vehicle-page";

const ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const CANONICAL = `/ilan/2021-bmw-320i-sedan-izmir-${ID}`;

const vehicle: VehiclePageData = {
  id: ID,
  sellerId: null,
  status: "active",
  brandName: "BMW",
  modelName: "320i",
  year: 2021,
  mileageKm: 85_000,
  price: 1_850_000,
  currency: "TRY",
  fuelType: "benzin",
  transmission: "otomatik",
  bodyType: "sedan",
  city: "İzmir",
  hasHeavyDamage: false,
  description: "Bakımlı </script> araç",
  photoUrls: [],
  videoThumbnailUrl: null,
  hasPlayableVideo: true,
};

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  nav.notFound.mockClear();
  nav.permanentRedirect.mockClear();
  pages.fetchVehiclePage.mockReset().mockResolvedValue(vehicle);
  db.row = null;
  db.error = null;
  db.selects.length = 0;
});

describe("eski adres /vehicles/<id> → 301", () => {
  function request(path: string) {
    return new NextRequest(`https://gozuyle.com${path}`);
  }

  it("ilanın tam /ilan/… adresine tek adımda 301; sorgu dizisi korunur", async () => {
    db.row = { id: ID, year: 2021, body_type: "sedan", city: "İzmir", brand: { name: "BMW" }, model: { name: "320i" } };
    const response = await GET(request(`/vehicles/${ID}?utm_source=whatsapp`), { params: Promise.resolve({ id: ID }) });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(`https://gozuyle.com${CANONICAL}?utm_source=whatsapp`);
    expect(db.selects[0]).toContain("body_type");
  });

  it("HEAD de aynı yönlendirmeyi verir", async () => {
    db.row = { id: ID, year: 2021, body_type: null, city: null, brand: { name: "BMW" }, model: { name: "320i" } };
    const response = await HEAD(request(`/vehicles/${ID}`), { params: Promise.resolve({ id: ID }) });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(`https://gozuyle.com/ilan/2021-bmw-320i-${ID}`);
  });

  it("ilan okunamazsa (yayında değil, yok) /ilan/<id>: orası 404; sorguya gidilmeyen bozuk kimlik de", async () => {
    const missing = await GET(request(`/vehicles/${ID.toUpperCase()}`), { params: Promise.resolve({ id: ID.toUpperCase() }) });
    expect(missing.status).toBe(301);
    expect(missing.headers.get("location")).toBe(`https://gozuyle.com/ilan/${ID}`);

    db.error = { message: "boom" };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await GET(request(`/vehicles/${ID}`), { params: Promise.resolve({ id: ID }) });
    expect(failed.headers.get("location")).toBe(`https://gozuyle.com/ilan/${ID}`);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();

    db.selects.length = 0;
    const invalid = await GET(request("/vehicles/abc"), { params: Promise.resolve({ id: "abc" }) });
    expect(invalid.headers.get("location")).toBe("https://gozuyle.com/ilan/abc");
    expect(db.selects).toHaveLength(0);
  });
});

describe("/ilan/[slug]", () => {
  it("doğru adreste sayfa çizilir; schema.org JSON-LD betiği güvenli", async () => {
    const html = renderToStaticMarkup(await VehiclePage(params(CANONICAL.slice("/ilan/".length))));
    expect(nav.permanentRedirect).not.toHaveBeenCalled();
    expect(pages.fetchVehiclePage).toHaveBeenCalledWith(ID);
    const script = /<script type="application\/ld\+json">([^<]*)<\/script>/.exec(html);
    expect(script).not.toBeNull();
    const data = JSON.parse(script![1]);
    expect(data["@type"]).toEqual(["Product", "Car"]);
    expect(data.offers).toMatchObject({ price: 1_850_000, priceCurrency: "TRY" });
    expect(data.mileageFromOdometer).toMatchObject({ value: 85_000, unitCode: "KMT" });
    expect(data.description).toBe("Bakımlı </script> araç");
    // Paylaşılan bağlantı da tam adres
    expect(html).toContain(`data-share-path="${CANONICAL}"`);
  });

  it("slug eksik, eski ya da kimlik büyük harfliyse tam adrese kalıcı yönlendirir", async () => {
    for (const slug of [ID, `2019-eski-model-${ID}`, `2021-bmw-320i-sedan-izmir-${ID.toUpperCase()}`]) {
      await expect(VehiclePage(params(slug))).rejects.toThrow(`NEXT_REDIRECT 308 ${CANONICAL}`);
    }
    expect(nav.permanentRedirect).toHaveBeenCalledTimes(3);
  });

  it("kimliksiz adres ve bulunamayan ilan 404", async () => {
    await expect(VehiclePage(params("2021-bmw-320i"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(pages.fetchVehiclePage).not.toHaveBeenCalled();
    pages.fetchVehiclePage.mockResolvedValue(null);
    await expect(VehiclePage(params(`x-${ID}`))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("metadata: canonical tam adres (slug'ı eksik istekte de)", async () => {
    const metadata = await listingMetadata(params(ID));
    expect(metadata.alternates?.canonical).toBe(CANONICAL);
    pages.fetchVehiclePage.mockResolvedValue(null);
    expect((await listingMetadata(params(ID))).title).toBe("İlan bulunamadı | gözüyle");
  });
});

describe("ana sayfa /?v=<id>", () => {
  const search = (query: Record<string, string>) => ({ searchParams: Promise.resolve(query) });

  it("canonical ilanın /ilan/… sayfası, paylaşım kartı ilanın; sekme başlığı ana sayfanın", async () => {
    const metadata = await homeMetadata(search({ v: ID }));
    expect(metadata.alternates?.canonical).toBe(CANONICAL);
    expect(metadata.openGraph).toMatchObject({ url: CANONICAL, title: "2021 BMW 320i - ₺1.850.000" });
    expect(metadata.title).toBe("gözüyle | Videolu araç ilanları");
  });

  it("ilansız, filtreli ya da bulunamayan ilanda canonical ana sayfa", async () => {
    expect((await homeMetadata(search({}))).alternates?.canonical).toBe("/");
    expect((await homeMetadata(search({ marka: "bmw" }))).alternates?.canonical).toBe("/");
    expect((await homeMetadata(search({ v: "abc" }))).alternates?.canonical).toBe("/");
    pages.fetchVehiclePage.mockRejectedValue(new Error("boom"));
    expect((await homeMetadata(search({ v: ID }))).alternates?.canonical).toBe("/");
  });

  it("deneme ilanıyla açılan adres de dizine eklenmez", async () => {
    pages.fetchVehiclePage.mockResolvedValue({ ...vehicle, isTest: true });
    expect((await homeMetadata(search({ v: ID }))).robots).toEqual({ index: false, follow: true });
  });
});
