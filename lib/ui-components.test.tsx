// @vitest-environment happy-dom
//
// Bileşen testleri: Vitrinim karesi, mesaj balonu, yazma alanı, rozet, akış
// sekmeleri, takip düğmesi, kullanıcı adı alanı ve profil sayıları.
// next/image ve next/link sade HTML öğeleriyle taklit edilir (uzak görsel
// ayarı ve yönlendirici gerekmesin).

import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
// next/font yalnızca Next derlemesinde çalışır (pencere ve düğmeler app/fonts'u içe aktarır)
vi.mock("../app/fonts", () => ({ displayFont: { variable: "" }, bodyFont: { variable: "" } }));

import EyePlayMark from "../components/brand/EyePlayMark";
import Logo from "../components/Logo";
import { ChatHeader, Composer, MessageBubble } from "../components/messages/ChatParts";
import UsernameField, { describeUsernameCheck } from "../components/profile/UsernameField";
import { canPromptOn } from "../components/profile/UsernameOnboarding";
import FeedTabs from "../components/social/FeedTabs";
import { FollowButtonView } from "../components/social/FollowButton";
import FollowingEmpty from "../components/social/FollowingEmpty";
import { MessageUserButtonView } from "../components/social/MessageUserButton";
import { ProfileStats } from "../components/social/ProfileHeader";
import BlockedUsersSheet from "../components/settings/BlockedUsersSheet";
import Switch from "../components/ui/Switch";
import ListingManageSheet from "../components/showcase/ListingManageSheet";
import ShowcaseTile from "../components/showcase/ShowcaseTile";
import UnreadBadge from "../components/ui/UnreadBadge";
import type { MyListing } from "./my-listings";
import { EYE_PATH, PLAY_POINTS } from "./brand-mark";
import type { ChatMessage, ConversationDetail } from "./messages";
import { USERNAME_CHECK_DELAY_MS, useUsernameCheck } from "./use-username-check";

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
  moderationStatus: "approved",
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

  it("içerik denetimindeki ilan: \"İnceleniyor\"", () => {
    render(<ShowcaseTile listing={{ ...listing, status: "pending_moderation", moderationStatus: "pending" }} onManage={vi.fn()} />);
    expect(screen.getByText("İnceleniyor")).toBeTruthy();
    expect(screen.getByRole("button", { name: /inceleniyor. Yönet/ })).toBeTruthy();
  });

  it("içerik denetiminin reddettiği ilan: medyası silinmiş, yalnızca \"Yayınlanmadı\"", () => {
    render(
      <ShowcaseTile
        listing={{ ...listing, status: "rejected", moderationStatus: "rejected", posterUrl: null, coverUrl: null }}
        onManage={vi.fn()}
      />,
    );
    expect(screen.getByText("Yayınlanmadı")).toBeTruthy();
    expect(screen.queryByText("Kapak yok")).toBeNull();
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

  it("gönderim reddedilirse (içerik filtresi) yazılan metin kutuda kalır", () => {
    const onSend = vi.fn(() => false);
    render(<Composer onSend={onSend} />);
    const area = screen.getByLabelText("Mesaj yaz") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "düzeltilecek metin" } });
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(area.value).toBe("düzeltilecek metin");
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

describe("ShowcaseTile (herkese açık profil)", () => {
  it("yönetim menüsü verilmezse köşe menüsü yok, kare ilana gider", () => {
    render(<ShowcaseTile listing={listing} />);
    expect(screen.getByRole("link", { name: /BMW 3 Serisi 2020/ }).getAttribute("href")).toBe("/vehicles/veh-1");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

const PANELS = { following: "p-following", explore: "p-explore" };

describe("FeedTabs", () => {
  it("iki sekme: seçili olan aria-selected, paneline bağlı; tıklayınca değişir", () => {
    const onChange = vi.fn();
    render(<FeedTabs active="explore" onChange={onChange} panelIds={PANELS} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Takip Edilenler", "Keşfet"]);
    const explore = screen.getByRole("tab", { name: "Keşfet" });
    expect(explore.getAttribute("aria-selected")).toBe("true");
    expect(explore.getAttribute("aria-controls")).toBe("p-explore");
    expect(explore.tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: "Takip Edilenler" }).tabIndex).toBe(-1);

    fireEvent.click(screen.getByRole("tab", { name: "Takip Edilenler" }));
    expect(onChange).toHaveBeenCalledWith("following");
  });

  it("ok tuşlarıyla gezilir", () => {
    const onChange = vi.fn();
    render(<FeedTabs active="explore" onChange={onChange} panelIds={PANELS} />);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("following");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("following");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("explore");
  });
});

describe("FollowingEmpty", () => {
  it("kimseyi takip etmiyorsa istenen metin ve Keşfet'e dönüş", () => {
    const onExplore = vi.fn();
    render(<FollowingEmpty kind="none" onExplore={onExplore} />);
    expect(screen.getByText("Henüz kimseyi takip etmiyorsun.")).toBeTruthy();
    expect(screen.getByText("İlgini çeken satıcıları vitrinlerinden takip et!")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Giriş yap" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Keşfet'e dön/ }));
    expect(onExplore).toHaveBeenCalledTimes(1);
  });

  it("misafirde giriş düğmesi", () => {
    const onSignIn = vi.fn();
    render(<FollowingEmpty kind="guest" onExplore={vi.fn()} onSignIn={onSignIn} />);
    fireEvent.click(screen.getByRole("button", { name: "Giriş yap" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("takip ettiklerinin videosu yoksa ayrı metin", () => {
    render(<FollowingEmpty kind="quiet" onExplore={vi.fn()} />);
    expect(screen.getByText(/yayında videolu ilanı yok/)).toBeTruthy();
  });
});

describe("FollowButtonView", () => {
  it("profilde Takip Et / Takibi Bırak; durum aria-pressed ile", () => {
    const onClick = vi.fn();
    const { rerender } = render(<FollowButtonView variant="profile" following={false} name="Kamil" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Kamil adlı kullanıcıyı takip et" });
    expect(button.textContent).toBe("Takip Et");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<FollowButtonView variant="profile" following name="Kamil" onClick={onClick} />);
    const following = screen.getByRole("button", { name: "Kamil adlı kullanıcıyı takibi bırak" });
    expect(following.textContent).toBe("Takibi Bırak");
    expect(following.getAttribute("aria-pressed")).toBe("true");
  });

  it("akışta takip edilen kişide düğme yok, yalnızca işaret (yanlışlıkla bırakılmaz)", () => {
    const { rerender } = render(<FollowButtonView variant="overlay" following={false} onClick={vi.fn()} />);
    expect(screen.getByRole("button").textContent).toContain("Takip et");
    rerender(<FollowButtonView variant="overlay" following onClick={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Takiptesin")).toBeTruthy();
  });
});

describe("UsernameField", () => {
  it("yazılanı kurala göre süzer (Türkçe harf, boşluk, büyük harf)", () => {
    const onChange = vi.fn();
    render(<UsernameField id="u" value="" onChange={onChange} check="idle" />);
    fireEvent.change(screen.getByLabelText("Kullanıcı adı"), { target: { value: "@Şahin Bey" } });
    expect(onChange).toHaveBeenCalledWith("sahin_bey");
  });

  it("müsait: yeşil tik; alınmış: kırmızı çarpı ve aria-invalid", () => {
    const { rerender, container } = render(<UsernameField id="u" value="kamil" onChange={vi.fn()} check="available" />);
    expect(screen.getByText("@kamil müsait.")).toBeTruthy();
    expect(container.querySelector(".lucide-circle-check")).toBeTruthy();
    expect(screen.getByLabelText("Kullanıcı adı").getAttribute("aria-invalid")).toBeNull();

    rerender(<UsernameField id="u" value="kamil" onChange={vi.fn()} check="taken" />);
    expect(screen.getByText("Bu kullanıcı adı alınmış.")).toBeTruthy();
    expect(container.querySelector(".lucide-circle-x")).toBeTruthy();
    expect(screen.getByLabelText("Kullanıcı adı").getAttribute("aria-invalid")).toBe("true");
  });

  it("kaydetme hatası durum metninin yerine geçer", () => {
    render(
      <UsernameField
        id="u"
        value="kamil"
        onChange={vi.fn()}
        check="available"
        error="Kullanıcı adını 7 günde bir değiştirebilirsin."
      />,
    );
    expect(screen.getByText("Kullanıcı adını 7 günde bir değiştirebilirsin.")).toBeTruthy();
  });

  it("durum metinleri", () => {
    expect(describeUsernameCheck("ka", "invalid")).toEqual({ tone: "neutral", text: "En az 3 karakter yaz." });
    expect(describeUsernameCheck("sell", "reserved").tone).toBe("bad");
    expect(describeUsernameCheck("kamil", "current").tone).toBe("ok");
    expect(describeUsernameCheck("kamil", "checking").text).toBe("Kontrol ediliyor…");
  });
});

describe("useUsernameCheck", () => {
  it("biçim ve rezerve anında; alınmışlık yazma durunca sunucudan; eski sonuç yenisini ezmez", async () => {
    vi.useFakeTimers();
    try {
      const check = vi.fn(async (name: string) => (name === "kamil" ? ("taken" as const) : ("available" as const)));
      const { result, rerender } = renderHook(({ name }) => useUsernameCheck(name, check), { initialProps: { name: "" } });
      expect(result.current).toBe("idle");

      rerender({ name: "ka" });
      expect(result.current).toBe("invalid");
      rerender({ name: "sell" });
      expect(result.current).toBe("reserved");
      expect(check).not.toHaveBeenCalled();

      rerender({ name: "kamil" });
      expect(result.current).toBe("checking");
      rerender({ name: "kamil_c" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(USERNAME_CHECK_DELAY_MS);
      });
      // Yalnızca son yazılan soruldu
      expect(check.mock.calls).toEqual([["kamil_c"]]);
      expect(result.current).toBe("available");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ProfileStats", () => {
  it("İlan | Takipçi | Takip Edilen, kısa sayı biçimiyle", () => {
    const { container } = render(<ProfileStats listings={3} followers={1250} following={0} />);
    const labels = [...container.querySelectorAll("dt")].map((dt) => dt.textContent);
    expect(labels).toEqual(["İlan", "Takipçi", "Takip Edilen"]);
    // Intl kısa biçimi bölünmez boşluk kullanır
    const values = [...container.querySelectorAll("dd")].map((dd) => dd.textContent?.replace(/\s/g, " "));
    expect(values).toEqual(["3", "1,3 B", "0"]);
  });
});

describe("canPromptOn (kullanıcı adı penceresi)", () => {
  it("ilan verme, sohbet, giriş dönüşü ve yönetim sayfalarında açılmaz", () => {
    for (const path of ["/", "/search", "/my-listings", "/messages", "/@kamil", "/vehicles/abc"]) {
      expect(canPromptOn(path)).toBe(true);
    }
    for (const path of ["/sell", "/auth/callback", "/messages/123", "/admin/reports", "/privacy", "/terms", null]) {
      expect(canPromptOn(path)).toBe(false);
    }
  });
});

describe("Switch", () => {
  it("role=switch, aria-checked; satıra dokununca ters değeri bildirir", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Switch label="Mesajlar" description="Biri sana mesaj gönderdiğinde" checked onChange={onChange} />);
    const toggle = screen.getByRole("switch", { name: "Mesajlar" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);

    rerender(<Switch label="Mesajlar" checked={false} onChange={onChange} />);
    expect(screen.getByRole("switch", { name: "Mesajlar" }).getAttribute("aria-checked")).toBe("false");
  });
});

describe("BlockedUsersSheet", () => {
  const blocked = [
    { id: "u1", username: "kamil", displayName: "Kamil", avatarUrl: null, blockedAt: "2026-09-27T10:00:00Z" },
    { id: "u2", username: null, displayName: null, avatarUrl: null, blockedAt: "2026-09-26T10:00:00Z" },
  ];

  it("engellenenleri adla listeler; adı ve kullanıcı adı olmayan için jenerik sistem adı yok", () => {
    render(<BlockedUsersSheet myId="me" users={blocked} onUnblocked={vi.fn()} onClose={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Engellenen kullanıcılar" });
    expect(list.textContent).toContain("Kamil");
    expect(list.textContent).toContain("@kamil");
    expect(list.textContent).toContain("Kullanıcı");
    expect(list.textContent).not.toContain("gözüyle üyesi");
    expect(screen.getAllByRole("button", { name: /engelini kaldır/ })).toHaveLength(2);
  });

  it("liste yüklenemediyse boş sanılmaz: hata ve tekrar dene", () => {
    const onRetry = vi.fn();
    render(<BlockedUsersSheet myId="me" users={null} failed onRetry={onRetry} onUnblocked={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText("Kimseyi engellemedin")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("liste boşsa açıklama gösterir", () => {
    render(<BlockedUsersSheet myId="me" users={[]} onUnblocked={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Kimseyi engellemedin")).toBeTruthy();
  });
});

describe("ChatHeader", () => {
  const listingDetail: ConversationDetail = {
    id: "c1",
    kind: "listing",
    role: "buyer",
    listing: { id: "v1", title: "BMW 320i 2019", price: 1250000, currency: "TRY", status: "active", coverUrl: null },
    partner: { id: "u2", displayName: "Kamil", avatarUrl: null, username: "kamil" },
    iBlocked: false,
    blockedMe: false,
  };

  it("ilandan başlatılan sohbet: ilan kartı; adın altında @kullanıcı_adı ve rol", () => {
    render(<ChatHeader detail={listingDetail} onBack={vi.fn()} onMenu={vi.fn()} />);
    expect(screen.getByText("BMW 320i 2019")).toBeTruthy();
    expect(screen.getByText("Kamil")).toBeTruthy();
    expect(screen.getByText("@kamil · Satıcı")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kamil vitrini" }).getAttribute("href")).toBe("/@kamil");
  });

  it("profilden (doğrudan) sohbet: ilan kartı ve rol yok, @kullanıcı_adı ve vitrin bağlantısı var", () => {
    render(
      <ChatHeader detail={{ ...listingDetail, kind: "direct", listing: null }} onBack={vi.fn()} onMenu={vi.fn()} />,
    );
    expect(screen.queryByText("BMW 320i 2019")).toBeNull();
    expect(screen.queryByText("Satıcı")).toBeNull();
    expect(screen.getByText("@kamil")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kamil vitrini" }).getAttribute("href")).toBe("/@kamil");
  });

  it("görünen ad yoksa başlık @kullanıcı_adı; alt satırda tekrar edilmez", () => {
    const { container } = render(
      <ChatHeader
        detail={{ ...listingDetail, kind: "direct", listing: null, partner: { id: "u2", displayName: null, avatarUrl: null, username: "kamil" } }}
        onBack={vi.fn()}
        onMenu={vi.fn()}
      />,
    );
    expect(screen.getAllByText("@kamil")).toHaveLength(1);
    expect(container.textContent).not.toContain("gözüyle üyesi");
  });

  it("ilanlı sohbette ne ad ne kullanıcı adı varsa rol başlık olur (jenerik ad yok)", () => {
    render(
      <ChatHeader
        detail={{ ...listingDetail, role: "seller", partner: { id: "u2", displayName: null, avatarUrl: null, username: null } }}
        onBack={vi.fn()}
        onMenu={vi.fn()}
      />,
    );
    expect(screen.getByText("Alıcı")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /vitrini/ })).toBeNull();
  });
});

describe("MessageUserButtonView", () => {
  it("ikincil Mesaj düğmesi; meşgulken kapalı", () => {
    const onClick = vi.fn();
    const { rerender } = render(<MessageUserButtonView name="Kamil" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Kamil adlı kullanıcıya mesaj gönder" }) as HTMLButtonElement;
    expect(button.textContent).toContain("Mesaj");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<MessageUserButtonView name="Kamil" busy onClick={onClick} />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("marka işareti", () => {
  it("tek renk SVG: ince göz hattı ve göz bebeğinde oynat üçgeni (currentColor, parlama yok)", () => {
    const { container } = render(<EyePlayMark className="h-9 w-9" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 100 100");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelector("path")?.getAttribute("d")).toBe(EYE_PATH);
    expect(svg.querySelector("path")?.getAttribute("stroke")).toBe("currentColor");
    expect(svg.querySelector("polygon")?.getAttribute("points")).toBe(PLAY_POINTS);
    expect(svg.querySelector("filter, linearGradient, radialGradient")).toBeNull();
  });

  it("başlık verilince erişilebilir görsel; logo yazıyla birlikte", () => {
    render(<EyePlayMark title="gözüyle" />);
    expect(screen.getByRole("img", { name: "gözüyle" })).toBeTruthy();
    const { container } = render(<Logo />);
    expect(container.textContent).toBe("gözüyle");
  });
});

describe("ListingManageSheet: içerik denetimi", () => {
  it("reddedilen ilan: topluluk kuralları uyarısı, aksiyon yok", () => {
    render(
      <ListingManageSheet
        listing={{ ...listing, status: "rejected", moderationStatus: "rejected" }}
        onClose={vi.fn()}
        onStatusChanged={vi.fn()}
      />,
    );
    expect(screen.getByText("Yüklenen içerik topluluk kurallarına uymadığı için yayınlanmadı.")).toBeTruthy();
    expect(screen.queryByText("Yayına al")).toBeNull();
  });

  it("denetimdeki ilan: bilgi notu", () => {
    render(
      <ListingManageSheet
        listing={{ ...listing, status: "pending_moderation", moderationStatus: "pending" }}
        onClose={vi.fn()}
        onStatusChanged={vi.fn()}
      />,
    );
    expect(screen.getByText(/İlanın içerik denetiminde/)).toBeTruthy();
  });

  it("denetimi bitmemiş arşivdeki ilan yayına alınamaz, nedeni yazılır", () => {
    render(
      <ListingManageSheet
        listing={{ ...listing, status: "archived", moderationStatus: "pending" }}
        onClose={vi.fn()}
        onStatusChanged={vi.fn()}
      />,
    );
    expect(screen.queryByText("Yayına al")).toBeNull();
    expect(screen.getByText("Yayına almak için içerik denetiminin tamamlanması gerekiyor.")).toBeTruthy();
  });
});
