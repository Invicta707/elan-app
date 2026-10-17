// @vitest-environment happy-dom
//
// /cansu-kamil sürpriz sayfası (app/cansu-kamil/CansuKamilView.tsx): portre ve başlık görünür;
// "Aşkımızı Ölç" 1,5 sn hesaplar, sonra sonuç kartı, kalp yağmuru ve "Bu akşam ne
// yapıyoruz?" kartı açılır; tüm bağlantılar doğru WhatsApp mesajlarına gider (api.whatsapp.com:
// wa.me yönlendirmesi emojileri bozuyor). Kapatma düğmesi (KillSwitch) yalnızca
// showKillSwitch ile çizilir; isteği yönetici oturumuyla gönderir. Sunucu tarafı
// (bayrak, rota, sayfa) lib/cansu-kamil-switch.test.ts'te.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CansuKamilView from "../app/cansu-kamil/CansuKamilView";
import KillSwitch from "../app/cansu-kamil/KillSwitch";

const getSession = vi.fn();
vi.mock("./supabase", () => ({ supabase: { auth: { getSession: () => getSession() } } }));

vi.mock("next/image", () => ({
  default: (allProps: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => {
    const props = { ...allProps };
    delete props.priority;
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={props.alt} />;
  },
}));

const PHONE = "https://api.whatsapp.com/send?phone=905445673430&text=";

describe("/cansu-kamil", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("portre, başlık, rozet ve sabit WhatsApp butonu ilk açılışta görünür", () => {
    render(<CansuKamilView />);
    expect(screen.getByRole("img", { name: "Cansu" }).getAttribute("src")).toBe("/images/cansu.jpg");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Güzeller güzeli Cansu");
    expect(screen.getByText("💖 1/1 · Paha Biçilemez · Ömürlük 💖")).toBeTruthy();

    const footer = screen.getByRole("link", { name: "Bana WhatsApp'tan yaz balım ❤️" });
    expect(footer.getAttribute("href")).toBe(
      `${PHONE}Siteni%20g%C3%B6rd%C3%BCm,%20inan%C4%B1lmaz%20g%C3%BCzel%20olmu%C5%9F!%20%E2%9D%A4%EF%B8%8F`,
    );
    // Emoji yüzde kodlu ve bozuk karakter (U+FFFD) yok
    expect(decodeURIComponent(footer.getAttribute("href") ?? "")).toContain("olmuş! ❤️");
    expect(document.body.innerHTML).not.toContain("wa.me");
    // Altında numara ya da ek metin yok
    expect(footer.closest("footer")?.textContent).toBe("Bana WhatsApp'tan yaz balım ❤️");

    // Akşam kartı ve sonuç henüz yok
    expect(screen.queryByText(/Bu akşam ne yapıyoruz/)).toBeNull();
    expect(screen.queryByText(/Aşk Oranı/)).toBeNull();
  });

  it("aşk ölçer 1,5 sn hesaplar, sonra sonuç, kalp yağmuru ve akşam kartı açılır", () => {
    render(<CansuKamilView />);
    const button = screen.getByRole("button", { name: "Aşkımızı Ölç ❤️" });
    fireEvent.click(button);

    expect(screen.getByText(/Hesaplanıyor\.\.\. %\d+\.\.\./)).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(screen.queryByText(/Aşk Oranı/)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByText("Aşk Oranı: %1000000 (Sonsuz Sevgi) 🔥")).toBeTruthy();
    expect(screen.getByTestId("heart-rain").children.length).toBeGreaterThan(0);
    expect(screen.getByText("Madem aşkımız tescillendi... Bu akşam ne yapıyoruz? 🥰")).toBeTruthy();

    expect(screen.getByRole("link", { name: /Wild Rift Oynayalım!/ }).getAttribute("href")).toBe(
      `${PHONE}A%C5%9Fk%C4%B1m%20hemen%20Wild%20Rift'e%20giriyoruz,%20beni%20ta%C5%9F%C4%B1man%20laz%C4%B1m!%20%E2%9A%94%EF%B8%8F%F0%9F%92%96`,
    );
    expect(screen.getByRole("link", { name: /Sesli Konuşalım!/ }).getAttribute("href")).toBe(
      `${PHONE}Hemen%20sesini%20duymak%20istiyorum,%20m%C3%BCsait%20olunca%20ara%20beni!%20%E2%98%8E%EF%B8%8F%E2%9D%A4%EF%B8%8F`,
    );

    // Kalp yağmuru birkaç saniye sonra temizlenir, kartlar kalır
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByTestId("heart-rain")).toBeNull();
    expect(screen.getByText(/Aşk Oranı/)).toBeTruthy();
  });

  it("kapatma düğmesi varsayılan olarak yok", () => {
    render(<CansuKamilView />);
    expect(screen.queryByRole("button", { name: /Sayfayı Kapat/ })).toBeNull();
  });
});

describe("KillSwitch (?admin=kamil)", () => {
  const reload = vi.fn();
  let confirmAnswer = true;

  beforeEach(() => {
    vi.useFakeTimers();
    reload.mockReset();
    getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "tok" } } });
    confirmAnswer = true;
    vi.spyOn(window, "confirm").mockImplementation(() => confirmAnswer);
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function clickKill(fetchImpl: typeof fetch) {
    render(<KillSwitch fetchImpl={fetchImpl} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sayfayı Kapat / 404 Yap" }));
    });
  }

  it("showKillSwitch ile sayfanın en altında, sabit WhatsApp düğmesinden önce çizilir", () => {
    render(<CansuKamilView showKillSwitch />);
    const button = screen.getByRole("button", { name: "Sayfayı Kapat / 404 Yap" });
    expect(button.closest("main")).toBeTruthy();
    expect(button.closest("main")?.lastElementChild?.contains(button)).toBe(true);
  });

  it("onaydan sonra yönetici token'ıyla POST { disabled: true } gönderir, sonra sayfayı yeniler", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ disabled: true }), { status: 200 }));
    await clickKill(fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledWith("/api/admin/cansu-kamil", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ disabled: true }),
    });
    expect(screen.getByRole("status").textContent).toBe("Sayfa kapatıldı.");
    expect(reload).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("onay verilmezse istek gitmez", async () => {
    confirmAnswer = false;
    const fetchImpl = vi.fn();
    await clickKill(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("oturum yoksa istek gitmez, giriş uyarısı çıkar", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const fetchImpl = vi.fn();
    await clickKill(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("Önce yönetici hesabıyla giriş yapmalısın.");
  });

  it("yönetici değilse (403) sunucunun mesajı gösterilir, sayfa yenilenmez", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: { code: "forbidden", message: "Bu işlem için yetkin yok." } }), { status: 403 }),
    );
    await clickKill(fetchImpl as unknown as typeof fetch);
    expect(screen.getByRole("status").textContent).toBe("Bu işlem için yetkin yok.");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(reload).not.toHaveBeenCalled();
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });
});
