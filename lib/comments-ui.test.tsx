// @vitest-environment happy-dom
//
// Yorum arayüzü: akıştaki yorum düğmesi ve alttan açılan yorum penceresi
// (yükleme, boş durum, misafir, iyimser gönderim ve silme, hata geri alma).
// Oturum, profil, giriş ve kullanıcı adı pencereleri taklit; ağ fetch taklidi.

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
vi.mock("./supabase", () => ({ supabase: {} }));
vi.mock("../app/fonts", () => ({ displayFont: { variable: "" }, bodyFont: { variable: "" } }));

type Session = { access_token: string; user: { id: string; email: string; user_metadata: Record<string, unknown> } };
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("./auth", () => ({ useSupabaseSession: () => ({ session: auth.session, isLoading: false }) }));
const me = vi.hoisted(() => ({ profile: null as null | { username: string | null; displayName: string | null; avatarUrl: string | null } }));
vi.mock("./use-my-profile", () => ({ useMyProfile: () => ({ profile: me.profile, loading: false, failed: false }) }));
vi.mock("../components/AuthGatedLink", () => ({ AuthModalPortal: () => <div>giriş penceresi</div> }));
vi.mock("../components/profile/UsernameSheet", () => ({ default: () => <div>kullanıcı adı penceresi</div> }));

import { CommentButtonView } from "../components/comments/CommentButton";
import CommentsSheet from "../components/comments/CommentsSheet";
import type { VehicleComment } from "./comments";

const VEHICLE = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";

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

beforeEach(() => {
  auth.session = null;
  me.profile = null;
  fetchMock = vi.fn(async () => json({ total: 0, comments: [], nextCursor: null }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function signIn(username: string | null = "ben") {
  auth.session = { access_token: "tok", user: { id: ME, email: "ben@ornek.com", user_metadata: {} } };
  me.profile = { username, displayName: "Ben", avatarUrl: null };
}

function openSheet(initialTotal = 0) {
  const onTotalChange = vi.fn();
  const onClose = vi.fn();
  render(<CommentsSheet vehicleId={VEHICLE} initialTotal={initialTotal} onTotalChange={onTotalChange} onClose={onClose} />);
  return { onTotalChange, onClose };
}

const composer = () => screen.getByLabelText("Yorum yaz") as HTMLTextAreaElement;

describe("yorum düğmesi (akış)", () => {
  it("sayı varsa sayı, yoksa 'Yorum'; pencere açar", () => {
    const onClick = vi.fn();
    const { rerender } = render(<CommentButtonView count={0} onClick={onClick} />);
    expect(screen.getByRole("button", { name: "Yorumlar" }).textContent).toContain("Yorum");
    rerender(<CommentButtonView count={1234} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Yorumlar (1234)" }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Yorumlar (1234)" }).textContent).toMatch(/1,2\s?B/);
  });
});

describe("yorum penceresi", () => {
  it("misafir: yorumlar okunur, yazma yerine giriş düğmesi", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ total: 2, comments: [comment("b", { username: "satici", isSeller: true }), comment("a")], nextCursor: null }),
    );
    openSheet(2);
    expect(await screen.findByText("Yorum b")).toBeTruthy();
    expect(screen.getByText("2 yorum")).toBeTruthy();
    expect(screen.getByText("Satıcı")).toBeTruthy();
    expect(screen.getAllByText(/5 dk önce/)).toHaveLength(2);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers).toEqual({});
    expect(screen.queryByLabelText("Yorum yaz")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Yorum yapmak için giriş yap" }));
    expect(screen.getByText("giriş penceresi")).toBeTruthy();
  });

  it("boş durum", async () => {
    openSheet();
    expect(await screen.findByText("Henüz yorum yok")).toBeTruthy();
    expect(screen.getByText("İlk yorumu sen yap!")).toBeTruthy();
  });

  it("iyimser gönderim: yorum anında en üstte, sunucu yanıtıyla değişir; sayaç artar", async () => {
    signIn();
    let resolvePost: (response: Response) => void = () => {};
    fetchMock.mockResolvedValueOnce(json({ total: 1, comments: [comment("a")], nextCursor: null }));
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (resolvePost = resolve)));
    const { onTotalChange } = openSheet(1);
    await screen.findByText("Yorum a");

    fireEvent.change(composer(), { target: { value: "  Hâlâ satılık mı?  " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    });
    expect(screen.getByText("Hâlâ satılık mı?")).toBeTruthy();
    expect(screen.getByText(/gönderiliyor/)).toBeTruthy();
    expect(composer().value).toBe("");
    expect(onTotalChange).toHaveBeenLastCalledWith(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`/api/vehicles/${VEHICLE}/comments`);
    expect(JSON.parse(init.body as string)).toEqual({ content: "Hâlâ satılık mı?" });

    await act(async () => {
      resolvePost(json({ comment: comment("new", { content: "Hâlâ satılık mı?", username: "ben", isMine: true, canDelete: true, createdAt: new Date().toISOString() }) }, 201));
    });
    expect(screen.queryByText(/gönderiliyor/)).toBeNull();
    expect(screen.getByRole("button", { name: "@ben yorumunu sil" })).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("Hâlâ satılık mı?");
  });

  it("kurala takılan yorum: listeden çıkar, metin kutuya döner, hata görünür, sayaç geri iner", async () => {
    signIn();
    fetchMock.mockResolvedValueOnce(json({ total: 0, comments: [], nextCursor: null }));
    fetchMock.mockResolvedValueOnce(json({ error: { code: "rate_limited", message: "Bu ilana az önce yorum yazdın." } }, 429));
    const { onTotalChange } = openSheet();
    await screen.findByText("Henüz yorum yok");
    fireEvent.change(composer(), { target: { value: "Merhaba" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Bu ilana az önce yorum yazdın."));
    expect(composer().value).toBe("Merhaba");
    expect(onTotalChange).toHaveBeenLastCalledWith(0);
    expect(screen.getByText("Henüz yorum yok")).toBeTruthy();
  });

  it("yerel filtre sunucuya gitmeden uyarır; ağ hatasında yorum 'Gönderilemedi' ile kalır", async () => {
    signIn();
    fetchMock.mockResolvedValueOnce(json({ total: 0, comments: [], nextCursor: null }));
    openSheet();
    await screen.findByText("Henüz yorum yok");
    fireEvent.change(composer(), { target: { value: "s1kt1r git" } });
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    expect(screen.getByRole("alert").textContent).toBe("Yorumunuz topluluk kurallarına uymayan ifadeler içeriyor.");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.change(composer(), { target: { value: "Merhaba" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    });
    expect(await screen.findByText(/Gönderilemedi/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tekrar dene" })).toBeTruthy();
  });

  it("kullanıcı adı yoksa önce kullanıcı adı penceresi; istek gitmez", async () => {
    signIn(null);
    openSheet();
    await screen.findByText("Henüz yorum yok");
    fireEvent.change(composer(), { target: { value: "Merhaba" } });
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    expect(screen.getByText("kullanıcı adı penceresi")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("silme onay ister; iyimser kaldırır, hata olursa geri koyar", async () => {
    signIn();
    fetchMock.mockResolvedValueOnce(json({ total: 1, comments: [comment("mine", { username: "ben", isMine: true, canDelete: true })], nextCursor: null }));
    const { onTotalChange } = openSheet(1);
    await screen.findByText("Yorum mine");

    fireEvent.click(screen.getByRole("button", { name: "@ben yorumunu sil" }));
    expect(screen.getByText("Yorum silinsin mi?")).toBeTruthy();
    fetchMock.mockResolvedValueOnce(json({ error: { code: "database_error", message: "Yorum silinemedi." } }, 500));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sil" }));
    });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`/api/vehicles/${VEHICLE}/comments/mine`);
    expect(init.method).toBe("DELETE");
    // Hata: yorum geri gelir
    expect(await screen.findByText("Yorum mine")).toBeTruthy();
    expect(screen.getByText("Yorum silinemedi.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "@ben yorumunu sil" }));
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sil" }));
    });
    expect(screen.queryByText("Yorum mine")).toBeNull();
    expect(onTotalChange).toHaveBeenLastCalledWith(0);
  });

  it("başkasının yorumunda 'Sil' yok", async () => {
    signIn();
    fetchMock.mockResolvedValueOnce(json({ total: 1, comments: [comment("x")], nextCursor: null }));
    openSheet(1);
    await screen.findByText("Yorum x");
    expect(screen.queryByRole("button", { name: /yorumunu sil/ })).toBeNull();
  });

  it("daha fazla yorum: imleçle sonraki sayfa", async () => {
    fetchMock.mockResolvedValueOnce(json({ total: 3, comments: [comment("c"), comment("b")], nextCursor: { before: "2026-09-28T10:00:00Z", beforeId: VEHICLE } }));
    fetchMock.mockResolvedValueOnce(json({ total: 3, comments: [comment("a")], nextCursor: null }));
    openSheet(3);
    await screen.findByText("Yorum c");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Daha fazla yorum" }));
    });
    expect(await screen.findByText("Yorum a")).toBeTruthy();
    const url = new URL((fetchMock.mock.calls.at(-1) as [string])[0], "https://gozuyle.com");
    expect(url.searchParams.get("beforeId")).toBe(VEHICLE);
    expect(screen.queryByRole("button", { name: "Daha fazla yorum" })).toBeNull();
  });

  it("yükleme hatası: tekrar dene", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { message: "Yorumlar yüklenemedi." } }, 500));
    openSheet();
    expect(await screen.findByText("Yorumlar yüklenemedi.")).toBeTruthy();
    fetchMock.mockResolvedValueOnce(json({ total: 0, comments: [], nextCursor: null }));
    fireEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(await screen.findByText("Henüz yorum yok")).toBeTruthy();
  });

  it("Esc / Android geri hareketi, dışarı dokunma ve X kapatır", async () => {
    const { onClose } = openSheet();
    const dialog = document.querySelector("dialog")!;
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    fireEvent.click(dialog);
    fireEvent.click(screen.getByRole("button", { name: "Yorumları kapat" }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("içteki pencerenin (giriş) Esc'i yorum penceresini kapatmaz", async () => {
    const { onClose } = openSheet();
    await screen.findByText("Henüz yorum yok");
    const inner = document.createElement("dialog");
    document.querySelector("dialog")!.appendChild(inner);
    fireEvent(inner, new Event("cancel", { cancelable: true, bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uzun yorumda sayaç; boşken gönder kapalı", async () => {
    signIn();
    openSheet();
    await screen.findByText("Henüz yorum yok");
    expect((screen.getByRole("button", { name: "Gönder" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(composer(), { target: { value: "a".repeat(450) } });
    expect(screen.getByText("450/500")).toBeTruthy();
    expect(composer().maxLength).toBe(500);
  });
});
