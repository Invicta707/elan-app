// @vitest-environment happy-dom
//
// Yorum şikayeti arayüzü (Google Play kullanıcı içeriği politikası): yorum
// satırındaki "Şikayet et", şikayet penceresi, yönetici panelindeki yorum
// şikayeti kartı ve masaüstünde "Yorum" düğmesinin yan panele yönlenmesi.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

type Session = { access_token: string; user: { id: string; email: string; user_metadata: Record<string, unknown> } };
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("./supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: auth.session } }) } },
}));
vi.mock("../app/fonts", () => ({ displayFont: { variable: "" }, bodyFont: { variable: "" } }));
vi.mock("./auth", () => ({ useSupabaseSession: () => ({ session: auth.session, isLoading: false }) }));
const me = vi.hoisted(() => ({ profile: null as null | { username: string | null; displayName: string | null; avatarUrl: string | null } }));
vi.mock("./use-my-profile", () => ({ useMyProfile: () => ({ profile: me.profile, loading: false, failed: false }) }));
vi.mock("../components/AuthGatedLink", () => ({ AuthModalPortal: () => <div>giriş penceresi</div> }));
vi.mock("../components/profile/UsernameSheet", () => ({ default: () => <div>kullanıcı adı penceresi</div> }));

import CommentButton from "../components/comments/CommentButton";
import CommentsSheet from "../components/comments/CommentsSheet";
import { FeedPanelContext } from "../components/feed/FeedPanelContext";
import { CommentReportCard } from "../components/moderation/CommentReportsSection";
import type { VehicleComment } from "./comments";
import type { CommentReportItem } from "./moderation";

const VEHICLE = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const COMMENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const comment = (id: string, overrides: Partial<VehicleComment> = {}): VehicleComment => ({
  id,
  userId: "someone",
  content: `Yorum ${id}`,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  username: "alici",
  displayName: null,
  avatarUrl: null,
  isSeller: false,
  isMine: false,
  canDelete: false,
  ...overrides,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let fetchMock: ReturnType<typeof vi.fn>;

function stubMatchMedia(desktop: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width: 64rem") ? desktop : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  auth.session = null;
  me.profile = null;
  fetchMock = vi.fn(async () => json({ total: 0, comments: [], nextCursor: null }));
  vi.stubGlobal("fetch", fetchMock);
  stubMatchMedia(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function signIn() {
  auth.session = { access_token: "tok", user: { id: ME, email: "ben@ornek.com", user_metadata: {} } };
  me.profile = { username: "ben", displayName: "Ben", avatarUrl: null };
}

async function openSheetWith(comments: VehicleComment[]) {
  fetchMock.mockResolvedValueOnce(json({ total: comments.length, comments, nextCursor: null }));
  const onClose = vi.fn();
  render(<CommentsSheet vehicleId={VEHICLE} initialTotal={comments.length} onClose={onClose} />);
  await screen.findByText(comments[0].content);
  return { onClose };
}

const reportPosts = () =>
  (fetchMock.mock.calls as [string, RequestInit][]).filter(([url, init]) => url === "/api/reports" && init?.method === "POST");

describe("yorum satırı: Şikayet et", () => {
  it("başkasının yorumunda var; kendi yorumunda ve gönderilmekte olanda yok; misafir de görür", async () => {
    await openSheetWith([comment("x"), comment("mine", { username: "ben", isMine: true, canDelete: true })]);
    expect(screen.getByRole("button", { name: "@alici yorumunu şikayet et" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "@ben yorumunu şikayet et" })).toBeNull();
    // Satıcı (silme hakkı olan) başkasının yorumunda hem Sil hem Şikayet et görür
    cleanup();
    signIn();
    await openSheetWith([comment("y", { canDelete: true })]);
    expect(screen.getByRole("button", { name: "@alici yorumunu sil" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "@alici yorumunu şikayet et" })).toBeTruthy();
  });

  it("neden seçilmeden gönderilmez; seçilince /api/reports'a yorum kimliğiyle gider, satır işaretlenir", async () => {
    signIn();
    await openSheetWith([comment(COMMENT, { content: "Hakaret içeren yorum" })]);
    fireEvent.click(screen.getByRole("button", { name: "@alici yorumunu şikayet et" }));
    expect(screen.getByRole("heading", { name: "Yorumu şikayet et" })).toBeTruthy();
    // Hangi yorumun şikayet edildiği pencerede görünür
    expect(screen.getAllByText("Hakaret içeren yorum")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Şikayet et" }));
    expect(await screen.findByText("Bir şikayet nedeni seç.")).toBeTruthy();
    expect(reportPosts()).toHaveLength(0);

    fireEvent.click(screen.getByLabelText("Taciz, hakaret ya da tehdit"));
    fireEvent.change(screen.getByLabelText(/Açıklama/), { target: { value: "  Küfür ediyor  " } });
    fetchMock.mockResolvedValueOnce(json({ ok: true }, 201));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Şikayet et" }));
    });
    expect(await screen.findByText("Teşekkürler, şikayetin bize ulaştı.")).toBeTruthy();
    const [, init] = reportPosts()[0];
    expect(JSON.parse(init.body as string)).toEqual({ commentId: COMMENT, reason: "harassment", details: "Küfür ediyor" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(screen.getByRole("img", { name: "@alici yorumu şikayet edildi" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "@alici yorumunu şikayet et" })).toBeNull();
  });

  it("misafir anonim gönderir; daha önce şikayet edildiyse söylenir", async () => {
    await openSheetWith([comment(COMMENT)]);
    fireEvent.click(screen.getByRole("button", { name: "@alici yorumunu şikayet et" }));
    fireEvent.click(screen.getByLabelText("Spam, reklam ya da alakasız içerik"));
    fetchMock.mockResolvedValueOnce(json({ ok: true, alreadyReported: true }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Şikayet et" }));
    });
    expect(await screen.findByText("Bu yorumu daha önce şikayet ettin.")).toBeTruthy();
    expect(reportPosts()[0][1].headers).not.toHaveProperty("Authorization");
  });

  it("sunucu hatası pencerede görünür, form kalır", async () => {
    await openSheetWith([comment(COMMENT)]);
    fireEvent.click(screen.getByRole("button", { name: "@alici yorumunu şikayet et" }));
    fireEvent.click(screen.getByLabelText("Nefret söylemi ya da ayrımcılık"));
    fetchMock.mockResolvedValueOnce(json({ error: { message: "Şikayet edilecek yorum bulunamadı; silinmiş olabilir." } }, 404));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Şikayet et" }));
    });
    expect(await screen.findByText("Şikayet edilecek yorum bulunamadı; silinmiş olabilir.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Şikayet et" })).toBeTruthy();
  });

  it("şikayet penceresinin Esc'i yorum penceresini kapatmaz; Vazgeç yalnızca şikayet penceresini kapatır", async () => {
    const { onClose } = await openSheetWith([comment(COMMENT)]);
    fireEvent.click(screen.getByRole("button", { name: "@alici yorumunu şikayet et" }));
    const reportDialog = screen.getByRole("heading", { name: "Yorumu şikayet et" }).closest("dialog")!;
    fireEvent(reportDialog, new Event("cancel", { cancelable: true, bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Yorumu şikayet et" })).toBeNull();
    expect(screen.getByText(`Yorum ${COMMENT}`)).toBeTruthy();
  });
});

describe("masaüstü: akıştaki Yorum düğmesi yan panele yönlenir", () => {
  it("1024 px ve üstünde pencere açılmaz, panel yorumlara odaklanır", () => {
    stubMatchMedia(true);
    const focusComments = vi.fn();
    render(
      <FeedPanelContext.Provider value={{ focusComments }}>
        <CommentButton vehicleId={VEHICLE} count={2} onCountChange={vi.fn()} />
      </FeedPanelContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Yorumlar (2)" }));
    expect(focusComments).toHaveBeenCalledWith(VEHICLE);
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("mobilde (ya da panel yoksa) alttan pencere açılır", async () => {
    render(
      <FeedPanelContext.Provider value={{ focusComments: vi.fn() }}>
        <CommentButton vehicleId={VEHICLE} count={0} onCountChange={vi.fn()} />
      </FeedPanelContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Yorumlar" }));
    expect(document.querySelector("dialog")).toBeTruthy();
    expect(await screen.findByText("Henüz yorum yok")).toBeTruthy();
  });
});

describe("yönetici paneli: yorum şikayeti kartı", () => {
  const item: CommentReportItem = {
    comment: {
      id: COMMENT,
      content: "Satıcı dolandırıcı, aramayın!!",
      createdAt: "2026-09-28T10:00:00Z",
      authorId: "author",
      authorUsername: "kotu_yorumcu",
      authorDisplayName: null,
      authorAvatarUrl: null,
    },
    vehicle: { id: VEHICLE, title: "Volkswagen Passat", year: 2019, status: "active", coverUrl: null },
    reports: [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", reason: "harassment", details: "İftira", createdAt: "2026-09-28T11:00:00Z" },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", reason: "spam", details: null, createdAt: "2026-09-28T12:00:00Z" },
    ],
  };
  const token = async () => "admin-tok";

  function renderCard() {
    const onResolved = vi.fn();
    const onUnauthorized = vi.fn();
    render(
      <CommentReportCard
        item={item}
        getAccessToken={token}
        onUnauthorized={onUnauthorized}
        onResolved={onResolved}
        now={Date.parse("2026-09-28T10:12:00Z")}
      />,
    );
    return { onResolved, onUnauthorized };
  }

  it("yorumun metni, yazarı, ilanı ve şikayet nedenleri görünür", () => {
    renderCard();
    expect(screen.getByText("Satıcı dolandırıcı, aramayın!!")).toBeTruthy();
    expect(screen.getByRole("link", { name: "@kotu_yorumcu" }).getAttribute("href")).toBe("/@kotu_yorumcu");
    expect(screen.getByText(/Volkswagen Passat · 2019/)).toBeTruthy();
    expect(screen.getByText("Taciz, hakaret ya da tehdit")).toBeTruthy();
    expect(screen.getByText("İftira")).toBeTruthy();
    expect(screen.getByText("Spam, reklam ya da alakasız içerik")).toBeTruthy();
    expect(screen.getByText("· 12 dk önce")).toBeTruthy();
  });

  it("Yorumu Sil onay ister, sonra delete_comment gönderir", async () => {
    const { onResolved } = renderCard();
    fetchMock.mockResolvedValueOnce(json({ ok: true, resolved: 2 }));
    fireEvent.click(screen.getByRole("button", { name: "Yorumu Sil" }));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Evet, sil" }));
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/comment-reports");
    expect(JSON.parse(init.body as string)).toEqual({ action: "delete_comment", commentId: COMMENT });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer admin-tok");
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith("@kotu_yorumcu: yorum silindi."));
  });

  it("Yoksay yalnızca gösterilen şikayetleri kapatır; yorum zaten silinmişse kart kalkar", async () => {
    const { onResolved } = renderCard();
    fetchMock.mockResolvedValueOnce(json({ ok: true, resolved: 2 }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Şikayetleri Yoksay" }));
    });
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({
      action: "dismiss",
      reportIds: item.reports.map((report) => report.id),
    });
    expect(onResolved).toHaveBeenCalledWith("@kotu_yorumcu: şikayetler yoksayıldı.");

    fetchMock.mockResolvedValueOnce(json({ error: { message: "Yorum bulunamadı; silinmiş olabilir." } }, 404));
    fireEvent.click(screen.getByRole("button", { name: "Yorumu Sil" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Evet, sil" }));
    });
    expect(onResolved).toHaveBeenLastCalledWith("@kotu_yorumcu: yorum zaten silinmiş.");
  });

  it("yetki hatası panelden çıkarır", async () => {
    const { onUnauthorized } = renderCard();
    fetchMock.mockResolvedValueOnce(json({ error: { message: "Bu sayfaya erişim yetkin yok." } }, 403));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Şikayetleri Yoksay" }));
    });
    expect(onUnauthorized).toHaveBeenCalled();
  });
});
