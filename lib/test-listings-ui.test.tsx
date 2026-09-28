// @vitest-environment happy-dom
//
// Moderasyon paneli → "Test ilanları": liste, onaylı toplu silme, kısmi hata ve yetki.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const api = vi.hoisted(() => ({ fetchTestListings: vi.fn(), deleteAllTestListings: vi.fn() }));
vi.mock("./moderation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./moderation")>()),
  fetchTestListings: api.fetchTestListings,
  deleteAllTestListings: api.deleteAllTestListings,
}));

import TestListingsSection from "../components/moderation/TestListingsSection";
import type { TestListing } from "./moderation";

const listing = (id: string, title: string): TestListing => ({
  id,
  title,
  year: 2019,
  price: 1_450_000,
  currency: "TRY",
  city: "İstanbul",
  status: "active",
  createdAt: new Date().toISOString(),
  coverUrl: `https://cf/${id}.jpg`,
  hasVideo: true,
});

const getAccessToken = async () => "tok";

beforeEach(() => {
  api.fetchTestListings.mockReset();
  api.deleteAllTestListings.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("TestListingsSection", () => {
  it("test ilanlarını listeler; onaydan sonra hepsini siler ve listeyi yeniler", async () => {
    api.fetchTestListings
      .mockResolvedValueOnce({ ok: true, items: [listing("v1", "BMW 3 Serisi"), listing("v2", "Fiat Egea")] })
      .mockResolvedValueOnce({ ok: true, items: [] });
    api.deleteAllTestListings.mockResolvedValueOnce({ ok: true, deleted: 2, failures: [] });
    render(<TestListingsSection getAccessToken={getAccessToken} onUnauthorized={vi.fn()} />);

    expect(await screen.findByText("2019 BMW 3 Serisi")).toBeTruthy();
    expect(screen.getByText(/2 test ilanı · vitrinde/)).toBeTruthy();
    expect(screen.getAllByText(/₺1\.450\.000 · İstanbul · Yayında/)).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Test ilanlarını sil (2)" }));
    expect(screen.getByText(/kalıcı olarak silinecek/)).toBeTruthy();
    expect(api.deleteAllTestListings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Evet, hepsini sil" }));

    await waitFor(() => expect(screen.getByText("2 test ilanı silindi.")).toBeTruthy());
    expect(api.deleteAllTestListings).toHaveBeenCalledWith("tok");
    expect(await screen.findByText(/Test ilanı yok/)).toBeTruthy();
    expect(api.fetchTestListings).toHaveBeenCalledTimes(2);
  });

  it("Vazgeç silmez", async () => {
    api.fetchTestListings.mockResolvedValue({ ok: true, items: [listing("v1", "BMW 3 Serisi")] });
    render(<TestListingsSection getAccessToken={getAccessToken} onUnauthorized={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Test ilanlarını sil (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(api.deleteAllTestListings).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Test ilanlarını sil (1)" })).toBeTruthy();
  });

  it("medyası silinemeyen ilanlar bildirilir", async () => {
    api.fetchTestListings.mockResolvedValue({ ok: true, items: [listing("v1", "BMW 3 Serisi"), listing("v2", "Fiat Egea")] });
    api.deleteAllTestListings.mockResolvedValueOnce({ ok: true, deleted: 1, failures: ["v2: video cf-9"] });
    render(<TestListingsSection getAccessToken={getAccessToken} onUnauthorized={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Test ilanlarını sil (2)" }));
    fireEvent.click(screen.getByRole("button", { name: "Evet, hepsini sil" }));
    expect(await screen.findByText(/1 test ilanı silindi; 1 ilanın medyası silinemedi/)).toBeTruthy();
    expect(screen.getByText("v2: video cf-9")).toBeTruthy();
  });

  it("yetki hatası panelden çıkarır; test ilanı yoksa silme düğmesi yok", async () => {
    const onUnauthorized = vi.fn();
    api.fetchTestListings.mockResolvedValueOnce({ ok: false, status: 403, message: "" });
    render(<TestListingsSection getAccessToken={getAccessToken} onUnauthorized={onUnauthorized} />);
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalled());
    cleanup();

    api.fetchTestListings.mockResolvedValueOnce({ ok: true, items: [] });
    render(<TestListingsSection getAccessToken={getAccessToken} onUnauthorized={vi.fn()} />);
    expect(await screen.findByText(/Test ilanı yok/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Test ilanlarını sil/ })).toBeNull();
  });
});
