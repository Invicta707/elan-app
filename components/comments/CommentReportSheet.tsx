"use client";

import { useId, useState, type FormEvent } from "react";
import { commentAuthorName, type DisplayComment } from "../../lib/comments";
import {
  COMMENT_REPORT_REASONS,
  MAX_REPORT_DETAILS,
  submitCommentReport,
  type CommentReportReason,
} from "../../lib/reports";
import { supabase } from "../../lib/supabase";
import BottomSheet from "../ui/BottomSheet";

// Yorumu şikayet et (Google Play kullanıcı içeriği politikası). Kayıt
// reports tablosuna gider (comment_id dolu) ve moderasyon panelinde
// "Yorum şikayetleri"nde görünür. Giriş yapmadan da gönderilebilir; oturum
// varsa aynı yorumun tekrarı sayılmaz. Şikayet edenin kimliği yazara gösterilmez.

type State = { step: "form" | "sending" } | { step: "done"; already: boolean };

export default function CommentReportSheet({
  comment,
  onClose,
  onReported,
}: {
  comment: DisplayComment;
  onClose: () => void;
  /** Gönderildi (ya da daha önce gönderilmişti): satır "Şikayet edildi" olur */
  onReported: (commentId: string) => void;
}) {
  const detailsId = useId();
  const [reason, setReason] = useState<CommentReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [state, setState] = useState<State>({ step: "form" });
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (state.step === "sending") return;
    if (!reason) {
      setError("Bir şikayet nedeni seç.");
      return;
    }
    setState({ step: "sending" });
    setError(null);
    // Oturum varsa şikayet eden kaydedilir (tekrar sayılmaz); yoksa anonim
    let accessToken: string | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      accessToken = data.session?.access_token ?? null;
    } catch {
      // Oturum okunamadı: şikayet anonim gider
    }
    const result = await submitCommentReport({ commentId: comment.id, reason, details: details.trim() || null }, accessToken);
    if (!result.ok) {
      setState({ step: "form" });
      setError(result.message);
      return;
    }
    onReported(comment.id);
    setState({ step: "done", already: result.already });
  }

  if (state.step === "done") {
    return (
      <BottomSheet title="Yorumu şikayet et" onClose={onClose} closeLabel="Kapat">
        <div role="status" className="px-6 pb-3 text-center">
          <p className="text-[16px] font-semibold text-[#15181C]">
            {state.already ? "Bu yorumu daha önce şikayet ettin." : "Teşekkürler, şikayetin bize ulaştı."}
          </p>
          <p className="mx-auto mt-1 max-w-xs text-[14px] text-[#5B616B]">
            Ekibimiz yorumu inceleyecek. Topluluk kurallarına aykırıysa kaldırılır. Kimliğin yorumun sahibiyle paylaşılmaz.
          </p>
        </div>
      </BottomSheet>
    );
  }

  const sending = state.step === "sending";

  return (
    <BottomSheet title="Yorumu şikayet et" onClose={onClose}>
      <form onSubmit={submit} className="px-4 pb-2">
        <blockquote className="mb-3 rounded-2xl bg-[#F2F3F5] px-3.5 py-2.5 text-[14px] leading-snug text-[#15181C]">
          <span className="block text-[12.5px] font-semibold text-[#5B616B]">{commentAuthorName(comment)}</span>
          <span className="line-clamp-2 break-words">{comment.content}</span>
        </blockquote>
        <fieldset>
          <legend className="mb-2 text-[14px] font-semibold text-[#15181C]">Sorun ne?</legend>
          <div className="flex flex-col gap-1.5">
            {(Object.keys(COMMENT_REPORT_REASONS) as CommentReportReason[]).map((key) => (
              <label
                key={key}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-2 text-[15px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#003399] ${
                  reason === key ? "border-[#003399] bg-[#EAEFF7] font-semibold text-[#003399]" : "border-[#E3E6EA] text-[#15181C]"
                }`}
              >
                <input
                  type="radio"
                  name="comment-report-reason"
                  value={key}
                  checked={reason === key}
                  onChange={() => {
                    setReason(key);
                    setError(null);
                  }}
                  className="sr-only"
                />
                {COMMENT_REPORT_REASONS[key]}
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor={detailsId} className="mt-3 mb-1 block text-[14px] font-semibold text-[#15181C]">
          Açıklama <span className="font-normal text-[#8A9099]">(isteğe bağlı)</span>
        </label>
        <textarea
          id={detailsId}
          rows={2}
          maxLength={MAX_REPORT_DETAILS}
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          className="w-full resize-none rounded-2xl border border-[#D5D9DF] px-3.5 py-2.5 text-[16px] text-[#15181C] outline-none focus:border-[#003399] focus:ring-4 focus:ring-[#003399]/10"
        />
        <div role="status" aria-live="polite">
          {error && <p className="mt-2 text-[13px] text-[#B42318]">{error}</p>}
        </div>
        <button
          type="submit"
          disabled={sending}
          aria-busy={sending}
          className="mt-3 h-12 w-full rounded-2xl bg-[#D92D20] text-[16px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#D92D20]/30"
        >
          {sending ? "Gönderiliyor…" : "Şikayet et"}
        </button>
      </form>
    </BottomSheet>
  );
}
