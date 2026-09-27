// @vitest-environment happy-dom
//
// Yönetim arayüzü: Vitrinim'deki "İlan Onay Paneli" girişi, seri inceleme
// (tam ekran video + Onayla / Reddet) ve panel kartı. next/image, next/link ve
// hls.js sade taklitlerle (happy-dom'da video oynatılamaz: oynatıcı "oynatılamadı"
// durumuna düşer, bu da silinmiş video durumunu sınar).

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
vi.mock("./supabase", () => ({ supabase: {} }));
vi.mock("hls.js", () => ({ default: { isSupported: () => false } }));

import { AdminEntryCardView } from "../components/moderation/AdminEntryCard";
import ListingReviewer, { type ReviewOutcome } from "../components/moderation/ListingReviewer";
import { PendingListingCard } from "../components/moderation/PendingListingsSection";
import { toPendingListing, type ListingDecision, type PendingListing, type PendingListingRow } from "./moderation";
import {
  ADMIN_STATUS_MAX_AGE_MS,
  adminListingDecided,
  adminStatusNeedsLoad,
  resetAdminStatusStore,
  type AdminStatusState,
} from "./use-admin-status";

afterEach(cleanup);

const THUMB = "https://customer-abc.cloudflarestream.com/0123456789abcdef0123456789abcdef/thumbnails/thumbnail.jpg";
const HLS = "https://customer-abc.cloudflarestream.com/0123456789abcdef0123456789abcdef/manifest/video.m3u8";

function listing(id: string, overrides: Partial<PendingListingRow> = {}, sellerUsername: string | null = "gozumkamil"): PendingListing {
  return toPendingListing(
    {
      id,
      seller_id: "s1",
      status: "pending_approval",
      moderation_status: "pending",
      moderation_reason: "ai:safe",
      description: "Bakımlı, hasarsız",
      year: 2019,
      price: "850000",
      currency: "TRY",
      mileage_km: 90000,
      city: "Bursa",
      created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
      views_count: 0,
      brand: { name: "Fiat" },
      model: { name: "Egea" },
      images: [{ image_url: `https://x/${id}/0.jpeg`, is_primary: true, display_order: 0 }],
      videos: [{ status: "ready", hls_url: HLS, thumbnail_url: THUMB, duration_seconds: 10 }],
      ...overrides,
    },
    { sellerUsername },
  );
}

describe("İlan Onay Paneli girişi (Vitrinim)", () => {
  it("bekleyen varsa rozet, alt metin ve seri incelemeyi açan 'İncele'", () => {
    render(<AdminEntryCardView status={{ admin: true, pendingListings: 3, openReports: 1 }} />);
    expect(screen.getByText("İlan Onay Paneli").closest("a")?.getAttribute("href")).toBe("/admin/reports");
    expect(screen.getByText("3 ilan onay bekliyor · 1 bildirim")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByRole("link", { name: "İncele: 3 ilan onay bekliyor" }).getAttribute("href")).toBe(
      "/admin/reports?incele=1",
    );
  });

  it("bekleyen yoksa rozet ve 'İncele' yok; 99 üstü 99+", () => {
    const { rerender } = render(<AdminEntryCardView status={{ admin: true, pendingListings: 0, openReports: 0 }} />);
    expect(screen.getByText("Onay bekleyen ilan yok")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /İncele/ })).toBeNull();
    rerender(<AdminEntryCardView status={{ admin: true, pendingListings: 140, openReports: null }} />);
    expect(screen.getByText("99+")).toBeTruthy();
  });
});

describe("useAdminStatus deposu", () => {
  beforeEach(resetAdminStatusStore);

  const state = (overrides: Partial<AdminStatusState>): AdminStatusState => ({
    userId: "u1",
    status: { admin: false },
    fetchedAt: 1_000,
    loading: false,
    stale: false,
    ...overrides,
  });

  it("yönetici olmayan oturum boyunca bir kez sorulur; yöneticinin sayıları eskiyince yeniden", () => {
    const now = 1_000 + ADMIN_STATUS_MAX_AGE_MS + 1;
    expect(adminStatusNeedsLoad(state({}), "u1", now)).toBe(false);
    expect(adminStatusNeedsLoad(state({ status: { admin: true, pendingListings: 1, openReports: 0 } }), "u1", now)).toBe(true);
    expect(adminStatusNeedsLoad(state({ status: { admin: true, pendingListings: 1, openReports: 0 } }), "u1", 2_000)).toBe(false);
  });

  it("kullanıcı değişince, hiç sorulmadıysa ya da karar verildiyse sorulur; istek sürerken sorulmaz", () => {
    expect(adminStatusNeedsLoad(state({}), "u2", 2_000)).toBe(true);
    expect(adminStatusNeedsLoad(state({ fetchedAt: 0 }), "u1", 2_000)).toBe(true);
    expect(adminStatusNeedsLoad(state({ stale: true }), "u1", 2_000)).toBe(true);
    expect(adminStatusNeedsLoad(state({ loading: true, fetchedAt: 0 }), "u1", 2_000)).toBe(false);
  });

  it("karar sonrası: yönetici değilken hiçbir şey olmaz", () => {
    expect(() => adminListingDecided()).not.toThrow();
  });
});

describe("Seri inceleme (tam ekran)", () => {
  const items = [listing("a"), listing("b", { moderation_reason: "review:suggestive", status: "pending_moderation" })];

  function renderReviewer(
    currentId: string | null,
    onDecide: (item: PendingListing, action: ListingDecision["action"]) => Promise<ReviewOutcome> = vi.fn(async () => ({
      ok: true as const,
      message: "Fiat Egea · 2019: onaylandı ve yayına alındı.",
    })),
  ) {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<ListingReviewer items={items} currentId={currentId} onNavigate={onNavigate} onDecide={onDecide} onClose={onClose} />);
    return { onNavigate, onClose, onDecide };
  }

  it("ilan bilgisi, sıra, satıcı ve temiz tarama etiketi; video uygulamanın içinde", () => {
    renderReviewer("a");
    expect(screen.getByText("Fiat Egea · 2019")).toBeTruthy();
    expect(screen.getByText(/1 \/ 2/)).toBeTruthy();
    expect(screen.getByText(/@gozumkamil/)).toBeTruthy();
    expect(screen.getByText(/12 dk önce/)).toBeTruthy();
    expect(screen.getByText("Otomatik tarama temiz · videoyu izleyip onayla")).toBeTruthy();
    expect(document.querySelector("dialog video")).toBeTruthy();
  });

  it("Onayla tek dokunuş: karar gönderilir, bildirim çıkar", async () => {
    const { onDecide } = renderReviewer("a");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Onayla" }));
    });
    expect(onDecide).toHaveBeenCalledWith(items[0], "approve");
    expect(screen.getByText("Fiat Egea · 2019: onaylandı ve yayına alındı.")).toBeTruthy();
  });

  it("Reddet onay ister (medya kalıcı silinir); Vazgeç geri döner", async () => {
    const { onDecide } = renderReviewer("a");
    fireEvent.click(screen.getByRole("button", { name: "Reddet" }));
    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByText(/kalıcı olarak silinir/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    fireEvent.click(screen.getByRole("button", { name: "Reddet" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Evet, reddet" }));
    });
    expect(onDecide).toHaveBeenCalledWith(items[0], "reject");
  });

  it("sunucu hatası (ör. video silinmiş) kartta görünür, düğmeler yeniden açılır", async () => {
    const onDecide = vi.fn(async () => ({ ok: false as const, message: "Bu ilanın videosu Cloudflare'de bulunamadı (silinmiş)." }));
    renderReviewer("a", onDecide);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Onayla" }));
    });
    expect(screen.getByText("Bu ilanın videosu Cloudflare'de bulunamadı (silinmiş).")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Onayla" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("Atla sıradaki ilana geçer (sondan başa döner)", () => {
    const { onNavigate } = renderReviewer("b");
    fireEvent.click(screen.getByRole("button", { name: /Atla/ }));
    expect(onNavigate).toHaveBeenCalledWith("a");
  });

  it("şüpheli ilan: kapak bulanık, video dokununca açılır; neden etiketi", () => {
    renderReviewer("b");
    expect(screen.getByText("Müstehcen görünüm")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Hassas içerik olabilir/ })).toBeTruthy();
  });

  it("oynatılamayan video (silinmiş) açıkça söylenir", async () => {
    renderReviewer("a");
    expect(await screen.findByText("Video oynatılamadı")).toBeTruthy();
    expect(screen.getByText(/silinmiş olabilir/)).toBeTruthy();
  });

  it("liste bitince 'Karar bekleyen ilan kalmadı'; kapat", () => {
    const { onClose } = renderReviewer(null);
    expect(screen.getByText("Karar bekleyen ilan kalmadı")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Panele dön" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc / Android geri hareketi (dialog cancel) kapatır", () => {
    const { onClose } = renderReviewer("a");
    fireEvent(document.querySelector("dialog")!, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Panel kartı", () => {
  it("kapağa dokununca seri inceleme bu ilandan açılır; ret onaylı; onay tek dokunuş", async () => {
    const onDecide = vi.fn(async () => ({ ok: true as const, message: "ok" }));
    const onReview = vi.fn();
    render(<PendingListingCard item={listing("a")} onDecide={onDecide} onReview={onReview} />);

    fireEvent.click(screen.getByRole("button", { name: "Fiat Egea · 2019: videoyu izle ve karar ver" }));
    expect(onReview).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reddet ve sil" }));
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Onayla ve yayınla" }));
    });
    expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ vehicle: expect.objectContaining({ id: "a" }) }), "approve");
  });

  it("görseller varsayılan gizli; açılınca kareler ve fotoğraflar", () => {
    render(<PendingListingCard item={listing("a")} onDecide={vi.fn()} onReview={vi.fn()} />);
    expect(screen.queryByRole("list", { name: "Video kareleri ve fotoğraflar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Görseller \(7\)/ }));
    expect(screen.getByRole("list", { name: "Video kareleri ve fotoğraflar" }).querySelectorAll("li")).toHaveLength(7);
  });
});
