import { NextResponse } from "next/server";
import { moderateText, recordModerationEvent } from "../../../lib/content-moderation-server";
import { isUuid } from "../../../lib/feed";
import { MESSAGE_COLUMNS, cleanMessage, messageError, messageInsertError } from "../../../lib/messages";
import { moderationProvidersFromEnv } from "../../../lib/moderation-providers";
import { createRateLimiter } from "../../../lib/rate-limit";
import {
  bearerToken,
  getAuthenticatedUserId,
  getSupabaseAdmin,
  getSupabaseForUser,
} from "../../../lib/supabase-server";
import { MESSAGE_POLICY_ERROR } from "../../../lib/text-moderation";

// POST /api/messages
//   headers: { Authorization: `Bearer <access_token>` }
//   body:    { conversationId, text }
// → 201 { message: { id, conversation_id, sender_id, text, is_read, created_at } }
// → 4xx/5xx { error: { code, message } }
//
// Mesaj yazılmadan önce içerik denetiminden geçer:
//   1) Temel filtre (lib/text-moderation.ts): küfür, tehdit, yasa dışı teklif.
//   2) OPENAI_API_KEY tanımlıysa OpenAI Moderation: taciz, tehdit, nefret,
//      cinsel içerik (anlama bakar; kelime listesinin kaçırdıklarını yakalar).
//      OpenAI'ye ulaşılamazsa mesaj geçer: sohbet sağlayıcı yüzünden durmaz,
//      taban kural veritabanında da var (fn_messages_text_filter).
// Mesaj, kullanıcının kendi oturumuyla yazılır: katılımcı, engel ve spam kuralları
// (RLS, tetikleyiciler) doğrudan yazımdakiyle aynı; Realtime aynı şekilde yayınlar.
// Reddedilen mesajın metni saklanmaz; yalnızca karar kaydedilir.

/** Sunucu örneği başına kullanıcıdan dakikada 60 istek (kalıcı sınır veritabanında: 30 mesaj/dk) */
const burst = createRateLimiter({ limit: 60, windowMs: 60_000 });

function errorResponse(status: number, code: string, message: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  const userId = token ? await getAuthenticatedUserId(request) : null;
  if (!token || !userId) return errorResponse(401, "unauthorized", "Mesaj göndermek için giriş yapmalısın.");

  const limited = burst(userId);
  if (!limited.ok) {
    return errorResponse(429, "rate_limited", "Çok hızlı mesaj gönderiyorsun; biraz bekleyip tekrar dene.", {
      "Retry-After": String(limited.retryAfterSeconds),
    });
  }

  const body = (await request.json().catch(() => null)) as { conversationId?: unknown; text?: unknown } | null;
  const conversationId = body?.conversationId;
  if (!isUuid(conversationId)) return errorResponse(400, "invalid_conversation", "Sohbet bulunamadı.");
  if (typeof body?.text !== "string") return errorResponse(400, "invalid_text", "Mesaj boş olamaz.");
  const invalid = messageError(body.text);
  if (invalid) return errorResponse(400, "invalid_text", invalid);
  const text = cleanMessage(body.text);

  const verdict = await moderateText(moderationProvidersFromEnv().text, text, { onProviderError: "allow" });
  if (verdict.decision === "rejected") {
    await recordModerationEvent(getSupabaseAdmin(), {
      subjectType: "message",
      subjectId: conversationId,
      userId,
      verdict,
    });
    return errorResponse(422, "content_policy", MESSAGE_POLICY_ERROR);
  }

  const { data, error } = await getSupabaseForUser(token)
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: userId, text })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error || !data) {
    const failure = messageInsertError(error);
    if (failure.status === 500) console.error("Mesaj yazılamadı:", error);
    return errorResponse(failure.status, failure.status === 403 ? "forbidden" : failure.status === 422 ? "rejected" : "database_error", failure.message);
  }
  return NextResponse.json({ message: data }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
