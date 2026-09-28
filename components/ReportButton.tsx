"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { bodyFont, displayFont } from "../app/fonts";
import {
  MAX_REPORT_DETAILS,
  REPORT_REASONS,
  submitReport,
  type ReportReason,
} from "../lib/reports";
import { supabase } from "../lib/supabase";
import { ACTION_BUTTON, ACTION_ICON, ACTION_ICON_BOX, ACTION_LABEL } from "./feed/actionStyles";

type ReportButtonProps = {
  vehicleId: string;
  /**
   * overlay: dikey videonun üstünde, sağdaki buton sütununda (etiketli)
   * page: ilan sayfasında sade metin bağlantısı
   */
  variant: "overlay" | "page";
  /** Modal açılıp kapanınca: akıştaki video modal açıkken duraklatılır */
  onOpenChange?: (open: boolean) => void;
};

export default function ReportButton({ vehicleId, variant, onOpenChange }: ReportButtonProps) {
  const [isOpen, setOpen] = useState(false);

  function setOpenState(open: boolean) {
    setOpen(open);
    onOpenChange?.(open);
  }

  return (
    <>
      {variant === "overlay" ? (
        <button
          type="button"
          onClick={() => setOpenState(true)}
          aria-haspopup="dialog"
          aria-label="İlanı bildir"
          className={ACTION_BUTTON}
        >
          <span className={ACTION_ICON_BOX}>
            <FlagIcon className={ACTION_ICON} />
          </span>
          <span aria-hidden="true" className={ACTION_LABEL}>
            Bildir
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpenState(true)}
          aria-haspopup="dialog"
          className="inline-flex h-10 items-center gap-1.5 rounded-md px-2 text-[14px] font-medium text-[#5B616B] hover:text-[#15181C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
        >
          <FlagIcon className="h-4 w-4" />
          İlanı bildir
        </button>
      )}

      {isOpen && createPortal(<ReportDialog vehicleId={vehicleId} onClose={() => setOpenState(false)} />, document.body)}
    </>
  );
}

type Status =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "error"; message: string }
  | { state: "sent"; already: boolean };

/** İlan bildirim penceresi; sohbet menüsü de kullanır (document.body'ye portal ile) */
export function ReportDialog({ vehicleId, onClose }: { vehicleId: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const detailsId = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function close() {
    dialogRef.current?.close();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason || status.state === "sending") return;

    setStatus({ state: "sending" });
    // Oturum varsa bildiren kaydedilir (aynı ilanı tekrar bildirme sayılmaz); yoksa anonim
    let accessToken: string | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      accessToken = data.session?.access_token ?? null;
    } catch {
      // Oturum okunamadı: bildirim anonim gider
    }
    const result = await submitReport({ vehicleId, reason, details: details.trim() || null }, accessToken);
    setStatus(result.ok ? { state: "sent", already: result.already } : { state: "error", message: result.message });
  }

  const sending = status.state === "sending";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className={`${displayFont.variable} ${bodyFont.variable} m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-2xl bg-white p-0 text-[#15181C] [font-family:var(--font-body)] backdrop:bg-black/50 sm:m-auto sm:max-w-md sm:rounded-2xl`}
    >
      <div className="flex max-h-[92dvh] flex-col">
        <div className="flex items-center justify-between border-b border-[#E3E6EA] px-4 py-3">
          <h2 id={titleId} className="text-[20px] font-semibold [font-family:var(--font-display)]">
            İlanı bildir
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Kapat"
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-[#F2F3F5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {status.state === "sent" ? (
            <div role="status" className="flex flex-col items-center gap-2 py-6 text-center">
              <p className="text-[16px] font-semibold">
                {status.already ? "Bu ilanı daha önce bildirdin." : "Teşekkürler, bildirimin bize ulaştı."}
              </p>
              <p className="max-w-xs text-[14px] text-[#5B616B]">
                Ekibimiz ilanı inceleyecek. Kurallara aykırıysa yayından kaldırılır.
              </p>
              <button
                type="button"
                onClick={close}
                className="mt-3 h-11 rounded-md border border-[#15181C] px-6 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
              >
                Kapat
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <p className="text-[14px] text-[#5B616B]">
                Bildirimin ekibimiz tarafından incelenir. Kimliğin satıcıyla paylaşılmaz.
              </p>

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-[14px] font-semibold">Sorun ne?</legend>
                {(Object.entries(REPORT_REASONS) as [ReportReason, string][]).map(([value, label]) => (
                  <label
                    key={value}
                    className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-[15px] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#003399] ${
                      reason === value ? "border-[#003399] bg-[#EEF2FB]" : "border-[#C9CED6]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="reason"
                      value={value}
                      checked={reason === value}
                      onChange={() => setReason(value)}
                      className="h-4 w-4 shrink-0 accent-[#003399] focus-visible:outline-none"
                    />
                    {label}
                  </label>
                ))}
              </fieldset>

              <div>
                <label htmlFor={detailsId} className="mb-1.5 block text-[14px] font-semibold">
                  Açıklama <span className="font-normal text-[#5B616B]">(isteğe bağlı)</span>
                </label>
                <textarea
                  id={detailsId}
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  maxLength={MAX_REPORT_DETAILS}
                  rows={3}
                  className="w-full resize-none rounded-md border border-[#C9CED6] bg-white px-3 py-2 text-base focus-visible:border-[#003399] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]/30"
                />
                <p className="mt-1 text-right text-[12px] text-[#5B616B]">
                  {details.length}/{MAX_REPORT_DETAILS}
                </p>
              </div>

              <div role="status" aria-live="polite">
                {status.state === "error" && <p className="text-[13px] text-[#B42318]">{status.message}</p>}
              </div>

              <button
                type="submit"
                disabled={!reason || sending}
                aria-busy={sending}
                className="h-12 rounded-md bg-[#B42318] text-[16px] font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B42318] focus-visible:ring-offset-2"
              >
                {sending ? "Gönderiliyor…" : "Bildir"}
              </button>
            </form>
          )}
        </div>
      </div>
    </dialog>
  );
}

function FlagIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
