"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import AuthModal from "./AuthModal";
import FeedHeader from "./FeedHeader";
import { requestAccountDeletion } from "../lib/account-deletion";
import { useSupabaseSession } from "../lib/auth";
import { LEGAL_CONTACT_EMAIL } from "../lib/legal";
import { supabase } from "../lib/supabase";

// /account: oturum bilgisi, çıkış ve hesap silme (Google Play zorunluluğu).
export default function AccountView() {
  const { session, isLoading } = useSupabaseSession();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await supabase.auth.signOut().catch(() => {});
    setSigningOut(false);
  }

  return (
    <>
      <FeedHeader activeTab="my-listings" tone="solid" />
      <div className="mx-auto max-w-2xl px-4 pt-2 pb-[max(2.5rem,calc(var(--bottom-nav-height)+1.5rem),env(safe-area-inset-bottom))]">
        <h1 className="text-[26px] font-semibold [font-family:var(--font-display)]">Hesabım</h1>

        {deleted ? (
          <div role="status" className="mt-8 rounded-lg bg-white p-5 text-center">
            <p className="text-[16px] font-semibold">Hesabın ve tüm verilerin silindi.</p>
            <p className="mt-1 text-[14px] text-[#5B616B]">gözüyle&apos;yi kullandığın için teşekkürler.</p>
            <Link
              href="/"
              className="mt-4 inline-flex h-11 items-center rounded-md bg-[#003399] px-5 text-[15px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
            >
              Ana sayfaya dön
            </Link>
          </div>
        ) : isLoading ? (
          <div aria-hidden="true" className="mt-6 h-40 animate-pulse rounded-lg bg-[#DDE1E6]" />
        ) : session ? (
          <>
            <section className="mt-5 rounded-lg bg-white p-4">
              <p className="text-[13px] text-[#5B616B]">Giriş yapılan hesap</p>
              <p className="mt-0.5 break-all text-[16px] font-semibold">{session.user.email ?? "E-posta yok"}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/my-listings"
                  className="inline-flex h-11 items-center rounded-md border border-[#C9CED6] px-4 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
                >
                  İlanlarım
                </Link>
                <button
                  type="button"
                  onClick={signOut}
                  disabled={signingOut}
                  className="inline-flex h-11 items-center rounded-md border border-[#C9CED6] px-4 text-[15px] font-semibold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
                >
                  {signingOut ? "Çıkış yapılıyor…" : "Çıkış yap"}
                </button>
              </div>
            </section>

            <section aria-labelledby="delete-account" className="mt-6 rounded-lg border border-[#F1C7C3] bg-white p-4">
              <h2 id="delete-account" className="text-[17px] font-semibold text-[#B42318]">
                Hesabı sil
              </h2>
              <p className="mt-1 text-[14px] leading-relaxed text-[#4A5058]">
                Hesabın; tüm ilanların (videoları ve fotoğraflarıyla), favorilerin ve iletişim bilgilerinle
                birlikte kalıcı olarak silinir. Bu işlem geri alınamaz.
              </p>
              <button
                type="button"
                onClick={() => setShowDeleteDialog(true)}
                aria-haspopup="dialog"
                className="mt-4 inline-flex h-11 items-center rounded-md border border-[#B42318] px-4 text-[15px] font-semibold text-[#B42318] hover:bg-[#FDEDEC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B42318] focus-visible:ring-offset-2"
              >
                Hesabımı sil
              </button>
            </section>
          </>
        ) : (
          <div className="mt-8 flex flex-col items-center gap-4 text-center">
            <p className="text-[15px] text-[#5B616B]">Hesap ayarlarını görmek için giriş yap.</p>
            <button
              type="button"
              onClick={() => setShowAuthModal(true)}
              className="h-12 rounded-md bg-[#003399] px-6 text-[16px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
            >
              Giriş yap
            </button>
            <p className="max-w-sm text-[13px] leading-relaxed text-[#5B616B]">
              Hesabına giriş yapamıyorsan, hesabının ve verilerinin silinmesini{" "}
              <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="font-semibold text-[#003399] underline">
                {LEGAL_CONTACT_EMAIL}
              </a>{" "}
              adresinden talep edebilirsin.
            </p>
          </div>
        )}
      </div>

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} onAuthenticated={() => setShowAuthModal(false)} />
      )}
      {showDeleteDialog && session && (
        <DeleteAccountDialog
          email={session.user.email ?? null}
          onClose={() => setShowDeleteDialog(false)}
          onDeleted={() => {
            setShowDeleteDialog(false);
            setDeleted(true);
          }}
        />
      )}
    </>
  );
}

function DeleteAccountDialog({
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
