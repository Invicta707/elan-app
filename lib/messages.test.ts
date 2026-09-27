import { beforeEach, describe, expect, it, vi } from "vitest";

const insertSingle = vi.fn();
vi.mock("./supabase", () => ({
  supabase: {
    from: () => ({ insert: () => ({ select: () => ({ single: insertSingle }) }) }),
    rpc: vi.fn(),
  },
}));

import {
  buildChatItems,
  dayLabel,
  formatBadge,
  inboxTimeLabel,
  mergeMessages,
  messageError,
  partnerHandle,
  partnerName,
  sendMessage,
  startDirectConversation,
  toConversationDetail,
  toConversationSummary,
  type ChatMessage,
} from "./messages";
import { supabase } from "./supabase";

const ME = "me";
const THEM = "them";

function message(id: string, senderId: string, createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, conversationId: "c1", senderId, text: id, isRead: false, createdAt, ...extra };
}

describe("formatBadge", () => {
  it.each([
    [0, null],
    [-3, null],
    [1, "1"],
    [99, "99"],
    [100, "99+"],
    [Number.NaN, null],
  ])("%s → %s", (count, label) => {
    expect(formatBadge(count)).toBe(label);
  });
});

describe("mergeMessages", () => {
  it("aynı id tek kalır; zamana göre sıralanır", () => {
    const a = message("a", ME, "2026-09-26T10:00:00Z");
    const b = message("b", THEM, "2026-09-26T10:01:00Z");
    expect(mergeMessages([b], [a, b]).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("iyimser mesaj sunucudaki karşılığıyla yer değiştirir (Realtime önce gelse de tek kalır)", () => {
    // Sunucu biçimi (+00:00, mikro saniye) ile istemci biçimi (Z) karışık
    const temp = message("tmp-1", ME, "2026-09-26T10:00:00.500Z", { pending: true });
    const saved = message("real-1", ME, "2026-09-26T10:00:00.100000+00:00");
    const afterRealtime = mergeMessages([temp], [saved]);
    expect(afterRealtime.map((m) => m.id)).toEqual(["real-1", "tmp-1"]);
    expect(mergeMessages(afterRealtime, [saved], { tempId: "tmp-1" }).map((m) => m.id)).toEqual(["real-1"]);
  });

  it("okundu bilgisi geri dönmez (sırasız olaylar)", () => {
    const read = message("a", ME, "2026-09-26T10:00:00Z", { isRead: true });
    const staleInsert = message("a", ME, "2026-09-26T10:00:00Z", { isRead: false });
    expect(mergeMessages([read], [staleInsert])[0].isRead).toBe(true);
  });
});

describe("tarih etiketleri", () => {
  const now = new Date(2026, 8, 26, 15, 0);

  it("gün ayracı: Bugün, Dün, tarih, başka yılsa yıl", () => {
    expect(dayLabel(new Date(2026, 8, 26, 9, 0).toISOString(), now)).toBe("Bugün");
    expect(dayLabel(new Date(2026, 8, 25, 23, 59).toISOString(), now)).toBe("Dün");
    expect(dayLabel(new Date(2026, 8, 12, 12, 0).toISOString(), now)).toBe("12 Eylül");
    expect(dayLabel(new Date(2025, 11, 31, 12, 0).toISOString(), now)).toBe("31 Aralık 2025");
  });

  it("gelen kutusu: bugün saat, dün, bu hafta gün adı, sonra tarih", () => {
    expect(inboxTimeLabel(new Date(2026, 8, 26, 9, 5).toISOString(), now)).toBe("09:05");
    expect(inboxTimeLabel(new Date(2026, 8, 25, 9, 5).toISOString(), now)).toBe("Dün");
    expect(inboxTimeLabel(new Date(2026, 8, 22, 9, 5).toISOString(), now)).toBe("Salı");
    expect(inboxTimeLabel(new Date(2026, 8, 1, 9, 5).toISOString(), now)).toBe("01.09.26");
  });
});

describe("buildChatItems", () => {
  it("gün ayracı ekler; aynı kişinin 5 dakika içindeki mesajlarını gruplar", () => {
    const now = new Date(2026, 8, 26, 15, 0);
    const items = buildChatItems(
      [
        message("1", THEM, new Date(2026, 8, 25, 20, 0).toISOString()),
        message("2", ME, new Date(2026, 8, 26, 10, 0).toISOString()),
        message("3", ME, new Date(2026, 8, 26, 10, 2).toISOString()),
        message("4", ME, new Date(2026, 8, 26, 10, 20).toISOString()),
        message("5", THEM, new Date(2026, 8, 26, 10, 21).toISOString()),
      ],
      ME,
      now,
    );
    expect(items.map((i) => (i.kind === "day" ? i.label : `${i.message.id}:${i.mine ? "ben" : "o"}:${i.groupStart ? "S" : "-"}${i.groupEnd ? "E" : "-"}`))).toEqual([
      "Dün",
      "1:o:SE",
      "Bugün",
      "2:ben:S-",
      "3:ben:-E",
      "4:ben:SE",
      "5:o:SE",
    ]);
  });
});

describe("küçük yardımcılar", () => {
  it("ad: görünen ad, yoksa @kullanıcı_adı, ikisi de yoksa karşı tarafın rolü; 'gözüyle üyesi' yok", () => {
    expect(partnerName({ displayName: "Ali", username: "ali_oto" })).toBe("Ali");
    expect(partnerName({ displayName: "  ", username: "ali_oto" })).toBe("@ali_oto");
    expect(partnerName({ displayName: null, username: null }, "buyer")).toBe("Satıcı");
    expect(partnerName({ displayName: null, username: null }, "seller")).toBe("Alıcı");
    expect(partnerName({ displayName: null, username: null })).toBe("Kullanıcı");
    expect(partnerName({ displayName: null })).not.toContain("gözüyle");
  });

  it("alt satır: yalnızca görünen ad varken @kullanıcı_adı (başlık zaten @ad ise tekrar yok)", () => {
    expect(partnerHandle({ displayName: "Ali", username: "ali_oto" })).toBe("@ali_oto");
    expect(partnerHandle({ displayName: null, username: "ali_oto" })).toBeNull();
    expect(partnerHandle({ displayName: "Ali", username: null })).toBeNull();
  });

  it("mesaj boş ya da çok uzun olamaz", () => {
    expect(messageError("   ")).toBe("Mesaj boş olamaz.");
    expect(messageError("a".repeat(2001))).toBe("Mesaj en fazla 2000 karakter olabilir.");
    expect(messageError(" merhaba ")).toBeNull();
  });

  it("gelen kutusu satırı veritabanı biçiminden dönüşür (tür alanı olmayan eski yanıt dahil)", () => {
    expect(
      toConversationSummary({
        id: "c1",
        updated_at: "2026-09-26T10:00:00Z",
        role: "seller",
        listing: { id: "v1", title: "BMW 3 Serisi 2020", price: 1250000, currency: "TRY", status: "active", cover_url: null },
        partner: { id: "u2", display_name: null, avatar_url: "https://x/a.webp" },
        last_message: { text: "Merhaba", sender_id: "u2", created_at: "2026-09-26T10:00:00Z", is_read: false },
        unread: 2,
      }),
    ).toEqual({
      id: "c1",
      updatedAt: "2026-09-26T10:00:00Z",
      kind: "listing",
      role: "seller",
      listing: { id: "v1", title: "BMW 3 Serisi 2020", price: 1250000, currency: "TRY", status: "active", coverUrl: null },
      partner: { id: "u2", displayName: null, avatarUrl: "https://x/a.webp", username: null },
      lastMessage: { text: "Merhaba", senderId: "u2", createdAt: "2026-09-26T10:00:00Z", isRead: false },
      unread: 2,
    });
  });
});

describe("sendMessage", () => {
  beforeEach(() => insertSingle.mockReset());

  it("metni kırpıp gönderir ve kaydedilen mesajı döner", async () => {
    insertSingle.mockResolvedValue({
      data: { id: "m1", conversation_id: "c1", sender_id: ME, text: "Merhaba", is_read: false, created_at: "2026-09-26T10:00:00Z" },
      error: null,
    });
    await expect(sendMessage("c1", ME, "  Merhaba  ")).resolves.toMatchObject({ id: "m1", text: "Merhaba" });
  });

  it("RLS reddi (engel) anlaşılır bir mesaja çevrilir", async () => {
    insertSingle.mockResolvedValue({ data: null, error: { code: "42501", message: "new row violates row-level security policy" } });
    await expect(sendMessage("c1", ME, "x")).rejects.toThrow("Bu sohbete mesaj gönderilemiyor.");
  });
});

describe("doğrudan (profilden) konuşmalar", () => {
  const rpc = vi.mocked(supabase.rpc);
  beforeEach(() => rpc.mockReset());

  it("RPC'nin türünü ve karşı tarafın kullanıcı adını okur", () => {
    const detail = toConversationDetail({
      id: "c1",
      kind: "direct",
      role: "buyer",
      listing: null,
      partner: { id: "u2", username: "kamil", display_name: "Kamil", avatar_url: null },
      i_blocked: false,
      blocked_me: false,
    });
    expect(detail).toMatchObject({ kind: "direct", listing: null, partner: { username: "kamil", displayName: "Kamil" } });

    const summary = toConversationSummary({
      id: "c2",
      updated_at: "2026-09-27T10:00:00Z",
      kind: "listing",
      role: "seller",
      listing: { id: "v1", title: "BMW 320i 2019", price: 1, currency: "TRY", status: "active", cover_url: null },
      partner: { id: "u3" },
      last_message: null,
      unread: 0,
    });
    expect(summary).toMatchObject({ kind: "listing", partner: { username: null } });
  });

  it("eski yanıtta tür yoksa ilandan çıkarılır", () => {
    const base = { id: "c1", role: "buyer", partner: { id: "u2" }, i_blocked: false, blocked_me: false };
    expect(toConversationDetail({ ...base, listing: null }).kind).toBe("direct");
    expect(toConversationDetail({ ...base, listing: { id: "v1" } }).kind).toBe("listing");
  });

  it("startDirectConversation: start_direct_conversation RPC'sini çağırır, hatayı Türkçe iletir", async () => {
    rpc.mockResolvedValue({ data: "conv-9", error: null } as never);
    expect(await startDirectConversation("u2")).toBe("conv-9");
    expect(rpc).toHaveBeenCalledWith("start_direct_conversation", { p_user_id: "u2" });

    rpc.mockResolvedValue({ data: null, error: { message: "Bu kullanıcıyla mesajlaşamazsın." } } as never);
    await expect(startDirectConversation("u2")).rejects.toThrow("Bu kullanıcıyla mesajlaşamazsın.");
  });
});
