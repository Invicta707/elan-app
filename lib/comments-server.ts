import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMMENTS_MAX_PAGE_SIZE,
  COMMENT_BLOCK_RESPONSES,
  cleanComment,
  commentError,
  isCommentBlockReason,
  toVehicleComment,
  type CommentCursor,
  type CommentRow,
  type CommentsPage,
  type VehicleComment,
} from "./comments";
import { moderateText, recordModerationEvent } from "./content-moderation-server";
import type { TextModerator } from "./moderation-providers";
import { COMMENT_POLICY_ERROR } from "./text-moderation";

// İlan yorumlarının sunucu tarafı (/api/vehicles/[id]/comments rotaları).
// Okuma ve yazma kullanıcının kendi oturumuyla (misafirde yayımlanabilir
// anahtarla) yapılır: RLS ve tetikleyiciler (yayında ilan, onaylı e-posta,
// kullanıcı adı, engel, metin filtresi, spam sınırı) doğrudan yazımdakiyle aynı.
// Yalnızca yönetici silmesi ve denetim kaydı servis anahtarıyla.

export type CommentsFailureResult = { ok: false; status: number; code: string; message: string };

// ---------------------------------------------------------------
// Okuma
// ---------------------------------------------------------------

export async function listVehicleComments(
  client: SupabaseClient,
  vehicleId: string,
  { cursor, limit, viewerIsAdmin = false }: { cursor: CommentCursor | null; limit: number; viewerIsAdmin?: boolean },
): Promise<{ ok: true; page: CommentsPage } | CommentsFailureResult> {
  const size = Math.min(Math.max(1, Math.floor(limit) || 1), COMMENTS_MAX_PAGE_SIZE);
  // Bir fazlası istenir: sonraki sayfa var mı
  const { data, error } = await client.rpc("list_vehicle_comments", {
    p_vehicle_id: vehicleId,
    p_limit: size + 1,
    p_before: cursor?.before ?? null,
    p_before_id: cursor?.beforeId ?? null,
  });
  if (error) {
    console.error("Yorumlar okunamadı:", vehicleId, error);
    return { ok: false, status: 500, code: "database_error", message: "Yorumlar yüklenemedi. Biraz sonra tekrar dene." };
  }
  if (!data) return { ok: false, status: 404, code: "vehicle_not_found", message: "İlan bulunamadı ya da yayında değil." };

  const result = data as { total?: number | null; comments?: CommentRow[] | null };
  const rows = result.comments ?? [];
  const comments = rows.slice(0, size).map((row) => {
    const comment = toVehicleComment(row);
    return viewerIsAdmin ? { ...comment, canDelete: true } : comment;
  });
  const last = comments.at(-1);
  return {
    ok: true,
    page: {
      total: Math.max(0, Number(result.total ?? 0)),
      comments,
      nextCursor: rows.length > size && last ? { before: last.createdAt, beforeId: last.id } : null,
    },
  };
}

// ---------------------------------------------------------------
// Yazma
// ---------------------------------------------------------------

type DbError = { code?: string; message?: string } | null;

/** Yazma hatası → HTTP. 42501 (RLS) için neden veritabanına sorulur. */
export async function commentInsertFailure(
  userClient: SupabaseClient,
  vehicleId: string,
  error: DbError,
): Promise<CommentsFailureResult> {
  const code = error?.code ?? "";
  if (code === "PT429") {
    return { ok: false, status: 429, code: "rate_limited", message: error?.message || "Çok hızlı yorum yazıyorsun; biraz bekle." };
  }
  if (code === "23514") {
    return error?.message === COMMENT_POLICY_ERROR
      ? { ok: false, status: 422, code: "content_policy", message: COMMENT_POLICY_ERROR }
      : { ok: false, status: 400, code: "invalid_content", message: "Yorum 1–500 karakter olmalı." };
  }
  if (code === "23503") {
    return { ok: false, status: 404, code: "listing_unavailable", message: COMMENT_BLOCK_RESPONSES.listing_unavailable.message };
  }
  if (code === "42501") {
    const { data } = await userClient.rpc("fn_comment_block_reason", { p_vehicle_id: vehicleId });
    const reason = isCommentBlockReason(data) ? data : "blocked";
    const response = COMMENT_BLOCK_RESPONSES[reason];
    return { ok: false, status: response.status, code: reason, message: response.message };
  }
  console.error("Yorum yazılamadı:", vehicleId, error);
  return { ok: false, status: 500, code: "database_error", message: "Yorum gönderilemedi. Biraz sonra tekrar dene." };
}

export async function createVehicleComment({
  userClient,
  adminClient,
  textModerator,
  userId,
  vehicleId,
  content: raw,
}: {
  /** Kullanıcının oturumuyla (RLS) */
  userClient: SupabaseClient;
  /** Yalnızca denetim kaydı için */
  adminClient: SupabaseClient;
  textModerator: TextModerator | null;
  userId: string;
  vehicleId: string;
  content: unknown;
}): Promise<{ ok: true; comment: VehicleComment } | CommentsFailureResult> {
  if (typeof raw !== "string") return { ok: false, status: 400, code: "invalid_content", message: "Yorum boş olamaz." };
  const content = cleanComment(raw);
  const invalid = commentError(content);
  if (invalid && invalid !== COMMENT_POLICY_ERROR) return { ok: false, status: 400, code: "invalid_content", message: invalid };

  // Temel filtre, varsa OpenAI (taciz, tehdit, nefret); sağlayıcıya ulaşılamazsa
  // temel filtrenin sonucu geçerli: taban kural veritabanında da var.
  const verdict = await moderateText(textModerator, content, { onProviderError: "allow" });
  if (verdict.decision === "rejected") {
    // Reddedilen yorumun metni saklanmaz; yalnızca karar
    await recordModerationEvent(adminClient, { subjectType: "comment", subjectId: vehicleId, userId, verdict });
    return { ok: false, status: 422, code: "content_policy", message: COMMENT_POLICY_ERROR };
  }

  const { data, error } = await userClient
    .from("vehicle_comments")
    .insert({ vehicle_id: vehicleId, content })
    .select("id, user_id, content, created_at")
    .single();
  if (error || !data) return commentInsertFailure(userClient, vehicleId, error);

  // Yazarın herkese açık yüzü ve satıcı etiketi (kendi profili ve yayındaki ilan okunabilir)
  const [profile, vehicle] = await Promise.all([
    userClient.from("profiles").select("username, display_name, avatar_url").eq("id", userId).maybeSingle(),
    userClient.from("vehicles").select("seller_id").eq("id", vehicleId).maybeSingle(),
  ]);
  const author = (profile.data ?? {}) as { username?: string | null; display_name?: string | null; avatar_url?: string | null };
  const row = data as { id: string; user_id: string; content: string; created_at: string };
  return {
    ok: true,
    comment: toVehicleComment({
      ...row,
      username: author.username,
      display_name: author.display_name,
      avatar_url: author.avatar_url,
      is_seller: (vehicle.data as { seller_id?: string } | null)?.seller_id === userId,
      is_mine: true,
      can_delete: true,
    }),
  };
}

// ---------------------------------------------------------------
// Silme
// ---------------------------------------------------------------

/**
 * Yazar ya da ilan sahibi: kendi oturumuyla (RLS da aynısını ister).
 * Yönetici (ADMIN_EMAILS): servis anahtarıyla, kararı kayda yazılır.
 */
export async function deleteVehicleComment({
  userClient,
  adminClient,
  userId,
  isAdmin,
  vehicleId,
  commentId,
}: {
  userClient: SupabaseClient;
  adminClient: SupabaseClient;
  userId: string;
  /** Yalnızca yazar ya da satıcı değilse sorulur */
  isAdmin: () => Promise<boolean>;
  vehicleId: string;
  commentId: string;
}): Promise<{ ok: true } | CommentsFailureResult> {
  const notFound: CommentsFailureResult = { ok: false, status: 404, code: "comment_not_found", message: "Yorum bulunamadı; silinmiş olabilir." };
  const { data, error } = await adminClient
    .from("vehicle_comments")
    .select("id, vehicle_id, user_id, vehicle:vehicles(seller_id)")
    .eq("id", commentId)
    .maybeSingle();
  if (error) {
    console.error("Yorum okunamadı:", commentId, error);
    return { ok: false, status: 500, code: "database_error", message: "Yorum silinemedi. Biraz sonra tekrar dene." };
  }
  const row = data as { id: string; vehicle_id: string; user_id: string; vehicle: { seller_id: string } | null } | null;
  if (!row || row.vehicle_id !== vehicleId) return notFound;

  const ownsComment = row.user_id === userId;
  const ownsListing = row.vehicle?.seller_id === userId;
  if (ownsComment || ownsListing) {
    const { data: deleted, error: deleteError } = await userClient.from("vehicle_comments").delete().eq("id", commentId).select("id");
    if (deleteError) {
      console.error("Yorum silinemedi:", commentId, deleteError);
      return { ok: false, status: 500, code: "database_error", message: "Yorum silinemedi. Biraz sonra tekrar dene." };
    }
    return deleted?.length ? { ok: true } : notFound;
  }

  if (!(await isAdmin())) return { ok: false, status: 403, code: "forbidden", message: "Bu yorumu silme yetkin yok." };
  const { error: adminError } = await adminClient.from("vehicle_comments").delete().eq("id", commentId);
  if (adminError) {
    console.error("Yorum (yönetici) silinemedi:", commentId, adminError);
    return { ok: false, status: 500, code: "database_error", message: "Yorum silinemedi. Biraz sonra tekrar dene." };
  }
  await recordModerationEvent(adminClient, {
    subjectType: "comment",
    subjectId: commentId,
    userId: row.user_id,
    moderatorId: userId,
    verdict: { decision: "rejected", reasons: [], scores: {}, provider: "manual" },
  });
  return { ok: true };
}
