// İlan paylaşım afişi (lib/og-vehicle.tsx, app/api/og/vehicle/[id]/route.tsx):
// metinler, görsel seçimi (satori yalnızca JPEG/PNG), görsellerin data:
// adresine indirilmesi, yazı tiplerinin alt küme olarak yüklenmesi, afişin
// içeriği, rota (yalnızca yayındaki ilan, önbellek başlığı) ve ilan
// sayfasının OpenGraph adresi. Ayrıca detay sorgusunun parça bilgisini okuması.

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pages = vi.hoisted(() => ({ fetchVehiclePage: vi.fn() }));
const og = vi.hoisted(() => ({ calls: [] as { element: unknown; options: Record<string, unknown> }[] }));
vi.mock("next/og", () => ({
  ImageResponse: class {
    status = 200;
    headers: Headers;
    constructor(element: unknown, options: Record<string, unknown>) {
      og.calls.push({ element, options });
      this.headers = new Headers((options.headers as Record<string, string>) ?? {});
      this.headers.set("content-type", "image/png");
    }
  },
}));
vi.mock("./vehicle-page", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vehicle-page")>();
  return { ...actual, fetchVehiclePage: pages.fetchVehiclePage };
});
const db = vi.hoisted(() => ({ vehicleRow: null as unknown, photos: [] as unknown[], selects: [] as string[] }));
vi.mock("./supabase", () => ({
  supabase: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      const done = () =>
        table === "vehicles" ? { data: db.vehicleRow, error: null } : { data: db.photos, error: null };
      builder.select = (columns: string) => {
        db.selects.push(`${table}:${columns}`);
        return builder;
      };
      builder.eq = () => builder;
      builder.order = () => builder;
      builder.maybeSingle = async () => done();
      builder.then = (resolve: (value: unknown) => void) => resolve(done());
      return builder;
    },
  },
}));

import { GET } from "../app/api/og/vehicle/[id]/route";
import { fetchVehicleDetails } from "./feed";
import {
  OG_CACHE_CONTROL,
  VehicleOgImage,
  fetchImageDataUrl,
  loadOgFonts,
  ogFacts,
  ogImageSources,
  ogPrice,
  ogText,
  ogTitle,
  type OgVehicle,
} from "./og-vehicle";
import { vehicleOgImagePath, type VehiclePageData } from "./vehicle-page";

const ID = "3eaeb102-fdf0-432d-8939-1d5de8f55d52";

const vehicle: OgVehicle = {
  brandName: "BMW",
  modelName: "3 Serisi",
  year: 2019,
  mileageKm: 78_000,
  city: "İstanbul",
  price: 1_450_000,
  currency: "TRY",
  isTest: false,
};

const page = (overrides: Partial<VehiclePageData> = {}): VehiclePageData => ({
  id: ID,
  sellerId: "s-1",
  status: "active",
  brandName: "BMW",
  modelName: "3 Serisi",
  year: 2019,
  mileageKm: 78_000,
  price: 1_450_000,
  currency: "TRY",
  fuelType: "benzin",
  transmission: "otomatik",
  bodyType: "sedan",
  city: "İstanbul",
  hasHeavyDamage: false,
  description: null,
  photoUrls: ["https://x.supabase.co/storage/v1/object/public/vehicle-photos/v/3.jpeg"],
  videoThumbnailUrl: "https://customer.cloudflarestream.com/uid/thumbnails/thumbnail.jpg",
  hasPlayableVideo: true,
  ...overrides,
});

function response(body: BodyInit, type: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": type } });
}

beforeEach(() => {
  og.calls.length = 0;
  pages.fetchVehiclePage.mockReset();
  db.selects.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("afiş metinleri ve görseller", () => {
  it("başlık, haplar, fiyat ('1.450.000 TL') ve yazı tipi alt kümesi", () => {
    expect(ogTitle(vehicle)).toBe("BMW 3 Serisi");
    expect(ogFacts(vehicle)).toEqual(["2019", "78.000 km", "İstanbul"]);
    expect(ogFacts({ ...vehicle, city: null })).toEqual(["2019", "78.000 km"]);
    expect(ogPrice(vehicle)).toBe("1.450.000 TL");
    expect(ogPrice({ price: 25_000, currency: "EUR" })).toBe("25.000 EUR");
    expect(ogText(vehicle)).toContain("İstanbul");
    expect(ogText(vehicle)).toContain("gözüyle");
  });

  it("arka plan: JPEG/PNG kapak fotoğrafı, yoksa video karesi; kart: video karesi (yükseklikli)", () => {
    expect(ogImageSources(page())).toEqual({
      background: "https://x.supabase.co/storage/v1/object/public/vehicle-photos/v/3.jpeg",
      poster: "https://customer.cloudflarestream.com/uid/thumbnails/thumbnail.jpg?height=480",
    });
    // WebP fotoğraf satori'de açılmaz: video karesi kullanılır
    expect(ogImageSources(page({ photoUrls: ["https://x/v/0.webp"] })).background).toBe(
      "https://customer.cloudflarestream.com/uid/thumbnails/thumbnail.jpg?height=630",
    );
    expect(ogImageSources(page({ videoThumbnailUrl: null }))).toEqual({
      background: "https://x.supabase.co/storage/v1/object/public/vehicle-photos/v/3.jpeg",
      poster: "https://x.supabase.co/storage/v1/object/public/vehicle-photos/v/3.jpeg",
    });
    expect(ogImageSources(page({ photoUrls: [], videoThumbnailUrl: null }))).toEqual({ background: null, poster: null });
  });

  it("görsel data: adresine indirilir; WebP, hata, boş ya da çok büyük görsel null", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(jpeg, "image/jpeg"))
      .mockResolvedValueOnce(response(jpeg, "image/webp"))
      .mockResolvedValueOnce(response("yok", "text/plain", 404))
      .mockRejectedValueOnce(new Error("ağ"))
      .mockResolvedValueOnce(response(new Uint8Array(5 * 1024 * 1024), "image/png"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchImageDataUrl("https://img/a.jpg")).toBe(`data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`);
    expect(await fetchImageDataUrl("https://img/b.webp")).toBeNull();
    expect(await fetchImageDataUrl("https://img/c.jpg")).toBeNull();
    expect(await fetchImageDataUrl("https://img/d.jpg")).toBeNull();
    expect(await fetchImageDataUrl("https://img/e.png")).toBeNull();
    expect(await fetchImageDataUrl(null)).toBeNull();
  });

  it("yazı tipleri yalnızca afişteki harflerle (TTF); indirilemezse boş liste", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith("https://fonts.googleapis.com")
        ? response("@font-face { src: url(https://fonts.gstatic.com/f.ttf) format('truetype'); }", "text/css")
        : response(new Uint8Array([1, 2, 3]), "font/ttf"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const fonts = await loadOgFonts("gözüyle İstanbul");
    expect(fonts.map((font) => `${font.name} ${font.weight}`)).toEqual(["Barlow Condensed 700", "Barlow 500", "Barlow 600"]);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`text=${encodeURIComponent("gözüyle İstanbul")}`);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ağ")));
    expect(await loadOgFonts("x")).toEqual([]);
  });

  it("afiş: başlık, fiyat plakası, haplar, logo, dikey video kartı; test ilanında etiket", () => {
    const html = renderToStaticMarkup(
      <VehicleOgImage vehicle={{ ...vehicle, isTest: true }} images={{ background: "data:image/jpeg;base64,AA", poster: "data:image/jpeg;base64,BB" }} />,
    );
    for (const text of ["BMW 3 Serisi", "1.450.000 TL", "2019", "78.000 km", "İstanbul", "gözüyle", "Videolu ilan", "TEST İLANI"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('src="data:image/jpeg;base64,AA"');
    expect(html).toContain('src="data:image/jpeg;base64,BB"');
    expect(renderToStaticMarkup(<VehicleOgImage vehicle={vehicle} images={{ background: null, poster: null }} />)).not.toContain("TEST İLANI");
  });
});

describe("GET /api/og/vehicle/[id]", () => {
  const call = (id: string) => GET(new Request(`https://gozuyle.com/api/og/vehicle/${id}`), { params: Promise.resolve({ id }) });

  it("yayındaki ilan: 1200×630 PNG, uygulamanın yazı tipleri, önbellek başlığı; görseller indirilir", async () => {
    pages.fetchVehiclePage.mockResolvedValue(page({ isTest: true }));
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("fonts.googleapis")
        ? response("src: url(https://fonts.gstatic.com/f.ttf) format('truetype')", "text/css")
        : url.includes("gstatic")
          ? response(new Uint8Array([1]), "font/ttf")
          : response(new Uint8Array([0xff, 0xd8]), "image/jpeg"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await call(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(OG_CACHE_CONTROL);
    expect(pages.fetchVehiclePage).toHaveBeenCalledWith(ID);
    const { element, options } = og.calls[0];
    expect(options).toMatchObject({ width: 1200, height: 630 });
    expect((options.fonts as unknown[]).length).toBe(3);
    const props = (element as { props: { vehicle: OgVehicle; images: { background: string; poster: string } } }).props;
    expect(props.vehicle).toMatchObject({ brandName: "BMW", price: 1_450_000, isTest: true });
    expect(props.images.background).toMatch(/^data:image\/jpeg;base64,/);
    expect(props.images.poster).toMatch(/^data:image\/jpeg;base64,/);
    const downloaded = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => !url.includes("font"));
    expect(downloaded.sort()).toEqual([
      "https://customer.cloudflarestream.com/uid/thumbnails/thumbnail.jpg?height=480",
      "https://x.supabase.co/storage/v1/object/public/vehicle-photos/v/3.jpeg",
    ]);
  });

  it("görsel ve yazı tipi indirilemezse afiş yine çizilir", async () => {
    pages.fetchVehiclePage.mockResolvedValue(page());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ağ")));
    const res = await call(ID);
    expect(res.status).toBe(200);
    expect(og.calls[0].options.fonts).toEqual([]);
  });

  it("olmayan, yayında olmayan ya da okunamayan ilan 404", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    pages.fetchVehiclePage.mockResolvedValueOnce(null).mockResolvedValueOnce(page({ status: "sold" })).mockRejectedValueOnce(new Error("db"));
    for (let i = 0; i < 3; i += 1) expect((await call(ID)).status).toBe(404);
    expect(og.calls).toHaveLength(0);
  });
});

describe("ilan sayfası ve detay sorgusu", () => {
  it("OpenGraph adresi ilana özel, fiyat değişince değişir", () => {
    expect(vehicleOgImagePath({ id: ID, price: 1_450_000 })).toBe(`/api/og/vehicle/${ID}?v=1450000`);
  });

  it("detay sorgusu expertise_summary'yi okur ve parça listesine çevirir", async () => {
    db.vehicleRow = { body_type: "sedan", description: " x ", expertise_summary: { parts: { hood: "painted", wing: "x" } } };
    db.photos = [];
    const details = await fetchVehicleDetails(ID);
    expect(db.selects).toContain("vehicles:body_type, description, expertise_summary");
    expect(details.bodyParts).toEqual({ hood: "painted" });

    db.vehicleRow = { body_type: null, description: null, expertise_summary: {} };
    expect((await fetchVehicleDetails(ID)).bodyParts).toBeNull();
  });
});
