"use client";

import { useEffect, useId, useRef, useState } from "react";
import { requestAccountDeletion } from "../../lib/account-deletion";
import { supabase } from "../../lib/supabase";

// Hesap silme onayı (Google Play: uygulama içinden hesap silme zorunluluğu).
// Sunucu (app/api/user/delete) kayıtları, fotoğrafları ve videoları siler.
export default function DeleteAccountDialog({
  email,
  onClose,
  onDeleted,
}: {
  email: string | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const confirmId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function handleDelete() {
    if (!confirmed || deleting) return;
    setDeleting(true);
    setError(null);

    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      setDeleting(false);
      setError("Oturumun sona ermiş. Tekrar giriş yapıp dene.");
      return;
    }

    const result = await requestAccountDeletion(accessToken);
    if (!result.ok) {
      setDeleting(false);
      setError(result.message);
      return;
    }
    // Hesap sunucuda silindi; cihazdaki oturumu da temizle
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    onDeleted();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        // Silme sürerken Esc ile kapatılmasın
        if (deleting) event.preventDefault();
      }}
      className="m-0 mt-auto w-full max-w-none rounded-t-2xl bg-white p-0 text-[#15181C] backdrop:bg-black/50 sm:m-auto sm:max-w-sm sm:rounded-2xl"
    >
      <div className="px-4 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <h2 id={titleId} className="text-[20px] font-semibold [font-family:var(--font-display)]">
          Hesabın silinsin mi?
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[#4A5058]">
          {email ? <strong className="break-all text-[#15181C]">{email}</strong> : "Hesabın"} ve buna bağlı
          ilanlar, videolar, fotoğraflar, favoriler ve iletişim bilgileri kalıcı olarak silinecek.
        </p>

        <label htmlFor={confirmId} className="mt-4 flex cursor-pointer items-start gap-3 text-[14px]">
          <input
            id={confirmId}
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            disabled={deleting}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[#B42318]"
          />
          Bu işlemin geri alınamayacağını anlıyorum.
        </label>

        <div role="status" aria-live="polite">
          {error && <p className="mt-3 text-[13px] text-[#B42318]">{error}</p>}
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleDelete}
            disabled={!confirmed || deleting}
            aria-busy={deleting}
            className="h-12 rounded-md bg-[#B42318] text-[16px] font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B42318] focus-visible:ring-offset-2"
          >
            {deleting ? "Siliniyor…" : "Hesabımı kalıcı olarak sil"}
          </button>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            disabled={deleting}
            className="h-12 rounded-md border border-[#C9CED6] text-[16px] font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            Vazgeç
          </button>
        </div>
      </div>
    </dialog>
  );
}
