"use client";

import { useId, useState, type FormEvent } from "react";
import { USER_REPORT_REASONS, reportUser, type UserReportReason } from "../../lib/messages";
import BottomSheet from "../ui/BottomSheet";

// Kullanıcıyı şikayet et (Google Play kullanıcı içeriği politikası). Kayıt
// user_reports tablosuna gider; kullanıcılar okuyamaz, moderasyon inceler.
export default function ReportUserSheet({
  reporterId,
  userId,
  conversationId,
  onClose,
}: {
  reporterId: string;
  userId: string;
  conversationId: string;
  onClose: () => void;
}) {
  const detailsId = useId();
  const [reason, setReason] = useState<UserReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "already">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason) return setError("Bir neden seç.");
    setState("sending");
    setError(null);
    try {
      const result = await reportUser({ reporterId, userId, conversationId, reason, details });
      setState(result.already ? "already" : "sent");
    } catch (err) {
      setState("idle");
      setError(err instanceof Error ? err.message : "Şikayet gönderilemedi.");
    }
  }

  if (state === "sent" || state === "already") {
    return (
      <BottomSheet title="Kullanıcıyı şikayet et" onClose={onClose}>
        <p role="status" className="px-6 pb-3 text-center text-[15px] text-[#15181C]">
          {state === "sent"
            ? "Şikayetin alındı. Ekibimiz inceleyecek; gerekirse hesap hakkında işlem yapılır."
            : "Bu kullanıcı hakkında açık bir şikayetin zaten var."}
        </p>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet title="Kullanıcıyı şikayet et" onClose={onClose}>
      <form onSubmit={submit} className="px-4 pb-2">
        <fieldset>
          <legend className="sr-only">Şikayet nedeni</legend>
          <div className="flex flex-col gap-1.5">
            {(Object.keys(USER_REPORT_REASONS) as UserReportReason[]).map((key) => (
              <label
                key={key}
                className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-[15px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#003399] ${
                  reason === key ? "border-[#003399] bg-[#EAEFF7] font-semibold text-[#003399]" : "border-[#E3E6EA]"
                }`}
              >
                <input
                  type="radio"
                  name="user-report-reason"
                  value={key}
                  checked={reason === key}
                  onChange={() => setReason(key)}
                  className="sr-only"
                />
                {USER_REPORT_REASONS[key]}
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor={detailsId} className="mt-3 mb-1 block text-[14px] font-semibold">
          Açıklama <span className="font-normal text-[#8A9099]">(isteğe bağlı)</span>
        </label>
        <textarea
          id={detailsId}
          rows={2}
          maxLength={500}
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          className="w-full rounded-2xl border border-[#D5D9DF] px-3.5 py-2.5 text-[16px] outline-none focus:border-[#003399] focus:ring-4 focus:ring-[#003399]/10"
        />
        <div role="status" aria-live="polite">
          {error && <p className="mt-2 text-[13px] text-[#B42318]">{error}</p>}
        </div>
        <button
          type="submit"
          disabled={state === "sending"}
          className="mt-3 h-12 w-full rounded-2xl bg-[#D92D20] text-[16px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#D92D20]/30"
        >
          {state === "sending" ? "Gönderiliyor…" : "Şikayet et"}
        </button>
      </form>
    </BottomSheet>
  );
}
