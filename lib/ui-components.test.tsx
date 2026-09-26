// @vitest-environment happy-dom
//
// Bileşen testleri: Vitrinim karesi, mesaj balonu, yazma alanı ve rozet.
// next/image ve next/link sade HTML öğeleriyle taklit edilir (uzak görsel
// ayarı ve yönlendirici gerekmesin).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ImgHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  // fill / priority next/image'a özgü; <img>'e geçmesin
  default: (allProps: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) => {
    const props = { ...allProps };
    delete props.fill;
    delete props.priority;
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

import { Composer, MessageBubble } from "../components/messages/ChatParts";
import ShowcaseTile from "../components/showcase/ShowcaseTile";
import UnreadBadge from "../components/ui/UnreadBadge";
import type { MyListing } from "./my-listings";
import type { ChatMessage } from "./messages";

afterEach(cleanup);

const listing: MyListing = {
  id: "veh-1",
  title: "BMW 3 Serisi",
  year: 2020,
  price: 1250000,
  currency: "TRY",
  mileageKm: 90000,
  city: "İzmir",
  status: "active",
  createdAt: "2026-09-20T10:00:00Z",
  coverUrl: "https://x/cover.jpg",
  posterUrl: "https://x/poster.jpg",
  hasPlayableVideo: true,
  viewsCount: 1234,
};

describe("ShowcaseTile", () => {
  it("yayındaki ilan: dikey kapak, fiyat hapı, görüntülenme; ilan sayfasına gider", () => {
    render(<ShowcaseTile listing={listing} onManage={vi.fn()} />);
    const link = screen.getByRole("link", { name: /BMW 3 Serisi 2020/ });
    expect(link.getAttribute("href")).toBe("/vehicles/veh-1");
    expect(link.className).toContain("aspect-[9/16]");
    expect(link.className).toContain("active:scale-95");
    expect(link.textContent).toContain("₺1,25 Mn");
    expect(link.textContent).toContain("1,2 B");
    expect(link.querySelector("img")?.getAttribute("src")).toBe("https://x/poster.jpg");
    expect(screen.queryByText("Yayında Değil")).toBeNull();
  });

  it("yayında olmayan ilan: kararır, etiket gösterir; dokununca yönetim menüsü açılır", () => {
    const onManage = vi.fn();
    render(<ShowcaseTile listing={{ ...listing, status: "archived" }} onManage={onManage} />);
    expect(screen.getByText("Yayında Değil")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /yayında değil\. Yönet/ }));
    expect(onManage).toHaveBeenCalledWith(expect.objectContaining({ id: "veh-1", status: "archived" }));
  });

  it("köşedeki menü butonu her durumda yönetimi açar", () => {
    const onManage = vi.fn();
    render(<ShowcaseTile listing={listing} onManage={onManage} />);
    fireEvent.click(screen.getByRole("button", { name: "BMW 3 Serisi ilanını yönet" }));
    expect(onManage).toHaveBeenCalledTimes(1);
  });
});

const baseMessage: ChatMessage = {
  id: "m1",
  conversationId: "c1",
  senderId: "me",
  text: "Merhaba, araç duruyor mu?",
  isRead: false,
  createdAt: "2026-09-26T11:05:00Z",
};

function renderBubble(message: ChatMessage, mine: boolean, onRetry = vi.fn()) {
  render(
    <ol>
      <MessageBubble message={message} mine={mine} groupStart groupEnd onRetry={onRetry} />
    </ol>,
  );
  return screen.getByRole("listitem");
}

describe("MessageBubble", () => {
  it("benim mesajım sağda, vurgulu; okunmamışta tek tik", () => {
    const item = renderBubble(baseMessage, true);
    expect(item.className).toContain("justify-end");
    expect(item.dataset.mine).toBe("true");
    expect(item.textContent).toContain("gönderildi");
    expect(item.querySelector(".lucide-check")).toBeTruthy();
    expect(item.querySelector(".lucide-check-check")).toBeNull();
  });

  it("okunduysa çift tik", () => {
    const item = renderBubble({ ...baseMessage, isRead: true }, true);
    expect(item.textContent).toContain("okundu");
    expect(item.querySelector(".lucide-check-check")).toBeTruthy();
  });

  it("karşı tarafın mesajı solda, gri; tik yok", () => {
    const item = renderBubble({ ...baseMessage, senderId: "them" }, false);
    expect(item.className).toContain("justify-start");
    expect(item.querySelector(".lucide-check, .lucide-check-check")).toBeNull();
    expect(item.textContent).toContain("Karşı taraf");
  });

  it("gönderilemeyen mesaj tekrar denenebilir", () => {
    const onRetry = vi.fn();
    renderBubble({ ...baseMessage, failed: true }, true, onRetry);
    fireEvent.click(screen.getByRole("button", { name: /Tekrar dene/ }));
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });
});

describe("Composer", () => {
  it("boşken gönder kapalı; yazılan metni kırpıp gönderir ve temizler", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const button = screen.getByRole("button", { name: "Gönder" }) as HTMLButtonElement;
    const area = screen.getByLabelText("Mesaj yaz") as HTMLTextAreaElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(area, { target: { value: "   " } });
    expect(button.disabled).toBe(true);

    fireEvent.change(area, { target: { value: "  Son fiyat nedir?  " } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledWith("Son fiyat nedir?");
    expect(area.value).toBe("");
  });
});

describe("UnreadBadge", () => {
  it("0'da görünmez, 99'un üstü 99+; ekran okuyucuya sayı söylenir", () => {
    const { container, rerender } = render(<UnreadBadge count={0} />);
    expect(container.textContent).toBe("");
    rerender(<UnreadBadge count={3} />);
    expect(container.textContent).toContain("3");
    expect(container.textContent).toContain("3 okunmamış mesaj");
    rerender(<UnreadBadge count={250} />);
    expect(container.textContent).toContain("99+");
  });
});
