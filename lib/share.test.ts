import { describe, expect, it, vi } from "vitest";
import { shareListing, shareMessage, whatsappShareUrl, type ShareEnvironment } from "./share";

const data = { url: "https://gozuyle.test/ilan/2021-porsche-911-veh-1", title: "2021 Porsche 911", text: "gözüyle'de 2021 Porsche 911" };
const WHATSAPP = whatsappShareUrl(data);

function env(overrides: Partial<ShareEnvironment> & { nav?: ShareEnvironment["nav"] } = {}): ShareEnvironment {
  return { nav: {}, isDesktop: false, openWindow: vi.fn(() => true), ...overrides };
}

describe("shareListing", () => {
  it("telefonda Web Share API ile sistem paylaşımını kullanır, başka bir şey açmaz", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    const e = env({ nav: { share, clipboard: { writeText } } });
    await expect(shareListing(data, e)).resolves.toEqual({ kind: "shared" });
    expect(share).toHaveBeenCalledWith(data);
    expect(writeText).not.toHaveBeenCalled();
    expect(e.openWindow).not.toHaveBeenCalled();
  });

  it("kullanıcı paylaşım menüsünü kapatırsa kopyalamaz, WhatsApp açmaz", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("closed", "AbortError"));
    const writeText = vi.fn();
    const e = env({ nav: { share, clipboard: { writeText } } });
    await expect(shareListing(data, e)).resolves.toEqual({ kind: "cancelled" });
    expect(writeText).not.toHaveBeenCalled();
    expect(e.openWindow).not.toHaveBeenCalled();
  });

  it("masaüstünde Web Share API olsa da kopyalar ve WhatsApp açar", async () => {
    const share = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const e = env({ isDesktop: true, nav: { share, clipboard: { writeText } } });
    await expect(shareListing(data, e)).resolves.toEqual({
      kind: "fallback",
      copied: true,
      whatsappOpened: true,
      whatsappUrl: WHATSAPP,
    });
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(data.url);
    expect(e.openWindow).toHaveBeenCalledWith(WHATSAPP);
  });

  it("Web Share API yoksa ya da veriyi reddederse kopyala + WhatsApp", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(shareListing(data, env({ nav: { clipboard: { writeText } } }))).resolves.toMatchObject({
      kind: "fallback",
      copied: true,
    });

    const share = vi.fn();
    await expect(
      shareListing(data, env({ nav: { share, canShare: () => false, clipboard: { writeText } } })),
    ).resolves.toMatchObject({ kind: "fallback" });
    expect(share).not.toHaveBeenCalled();
  });

  it("paylaşım başka bir hatayla başarısız olursa kopyala + WhatsApp'a düşer", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(shareListing(data, env({ nav: { share, clipboard: { writeText } } }))).resolves.toMatchObject({
      kind: "fallback",
      copied: true,
    });
  });

  it("pano da açılır pencere de engellenirse bunu bildirir", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("no permission"));
    const e = env({ nav: { clipboard: { writeText } }, openWindow: () => false });
    await expect(shareListing(data, e)).resolves.toEqual({
      kind: "fallback",
      copied: false,
      whatsappOpened: false,
      whatsappUrl: WHATSAPP,
    });
    await expect(shareListing(data, env({ openWindow: () => false }))).resolves.toMatchObject({ copied: false });
  });
});

describe("whatsappShareUrl", () => {
  it("metin ve bağlantıyı tek mesajda, kodlanmış olarak taşır", () => {
    const url = new URL(WHATSAPP);
    expect(url.origin).toBe("https://wa.me");
    expect(url.searchParams.get("text")).toBe(`${data.text} ${data.url}`);
  });
});

describe("shareMessage", () => {
  const fallback = (copied: boolean, whatsappOpened: boolean) =>
    ({ kind: "fallback", copied, whatsappOpened, whatsappUrl: WHATSAPP }) as const;

  it("sistem paylaşımında ve iptalde mesaj yok", () => {
    expect(shareMessage({ kind: "shared" })).toBeNull();
    expect(shareMessage({ kind: "cancelled" })).toBeNull();
  });

  it("WhatsApp açılamadıysa tıklanabilir bağlantı sunulur", () => {
    expect(shareMessage(fallback(true, true))).toEqual({
      text: "Bağlantı kopyalandı, WhatsApp açılıyor.",
      showWhatsappLink: false,
    });
    expect(shareMessage(fallback(true, false))).toEqual({ text: "Bağlantı kopyalandı.", showWhatsappLink: true });
    expect(shareMessage(fallback(false, true))?.showWhatsappLink).toBe(false);
    expect(shareMessage(fallback(false, false))?.showWhatsappLink).toBe(true);
  });
});
