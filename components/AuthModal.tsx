"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

type AuthMode = "login" | "signup" | "magic";
type Status = "idle" | "loading" | "error" | "magic-sent";

type AuthModalProps = {
  onClose: () => void;
  /** Giriş/kayıt başarıyla tamamlanınca çağrılır (supabase istemcisindeki oturum zaten güncel) */
  onAuthenticated?: () => void;
};

// Supabase Auth ile çalışan sade giriş/kayıt modalı: e-posta+şifre ya da
// şifresiz "magic link". FilterSheet ile aynı alttan açılan dialog deseni.
export default function AuthModal({ onClose, onAuthenticated }: AuthModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const emailId = useId();
  const passwordId = useId();

  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();

    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previousOverflow;
    };
  }, []);

  function close() {
    dialogRef.current?.close();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "loading") return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) return;

    setStatus("loading");
    setErrorMessage(null);

    try {
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email: trimmedEmail,
          options: { emailRedirectTo: window.location.href },
        });
        if (error) throw error;
        setStatus("magic-sent");
        return;
      }

      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: { emailRedirectTo: window.location.href },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;
      }

      setStatus("idle");
      onAuthenticated?.();
      close();
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? translateAuthError(error.message) : "Bir şeyler ters gitti.",
      );
    }
  }

  const isMagic = mode === "magic";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-2xl bg-white p-0 text-[#15181C] backdrop:bg-black/50 sm:m-auto sm:max-w-sm sm:rounded-2xl"
    >
      <div className="flex max-h-[92dvh] flex-col">
        <div className="flex items-center justify-between border-b border-[#E3E6EA] px-4 py-3">
          <h2 id={titleId} className="text-[20px] font-semibold [font-family:var(--font-display)]">
            {mode === "signup" ? "Hesap oluştur" : "Giriş yap"}
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

        <div className="flex-1 overflow-y-auto px-4 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {status === "magic-sent" ? (
            <div role="status" className="py-6 text-center">
              <p className="text-[16px] font-semibold">E-postana bir bağlantı gönderdik.</p>
              <p className="mt-1.5 text-[14px] text-[#5B616B]">
                {email.trim()} adresine gelen bağlantıya dokunarak giriş yapabilirsin.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label htmlFor={emailId} className="mb-1.5 block text-[14px] font-semibold">
                  E-posta
                </label>
                <input
                  id={emailId}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={fieldClass}
                />
              </div>

              {!isMagic && (
                <div>
                  <label htmlFor={passwordId} className="mb-1.5 block text-[14px] font-semibold">
                    Şifre
                  </label>
                  <input
                    id={passwordId}
                    type="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    required
                    minLength={6}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={fieldClass}
                  />
                </div>
              )}

              <div role="status" aria-live="polite">
                {errorMessage && <p className="text-[13px] text-[#B42318]">{errorMessage}</p>}
              </div>

              <button
                type="submit"
                disabled={status === "loading"}
                aria-busy={status === "loading"}
                className="h-12 rounded-md bg-[#003399] text-[16px] font-semibold text-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
              >
                {status === "loading"
                  ? "Gönderiliyor…"
                  : isMagic
                    ? "Bağlantı gönder"
                    : mode === "signup"
                      ? "Hesap oluştur"
                      : "Giriş yap"}
              </button>

              <div className="flex flex-col items-center gap-2 pt-1 text-[14px]">
                {!isMagic && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode(mode === "signup" ? "login" : "signup");
                      setErrorMessage(null);
                    }}
                    className="rounded-sm font-semibold text-[#003399] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
                  >
                    {mode === "signup"
                      ? "Zaten hesabın var mı? Giriş yap"
                      : "Hesabın yok mu? Kayıt ol"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMode(isMagic ? "login" : "magic");
                    setErrorMessage(null);
                  }}
                  className="rounded-sm text-[#5B616B] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
                >
                  {isMagic ? "Şifreyle giriş yap" : "Şifresiz, e-posta bağlantısıyla giriş yap"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </dialog>
  );
}

const fieldClass =
  "h-12 w-full rounded-md border border-[#C9CED6] bg-white px-3 text-base text-[#15181C] focus-visible:border-[#003399] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]/30";

// Supabase'in İngilizce hata metinlerinin bilinenlerini Türkçeye çevirir;
// tanınmayan bir mesaj gelirse olduğu gibi gösterilir.
function translateAuthError(message: string): string {
  const known: Record<string, string> = {
    "Invalid login credentials": "E-posta ya da şifre hatalı.",
    "User already registered": "Bu e-posta ile zaten bir hesap var.",
    "Email not confirmed": "E-postanı onaylaman gerekiyor. Gelen kutunu kontrol et.",
    "Password should be at least 6 characters.": "Şifre en az 6 karakter olmalı.",
  };
  return known[message] ?? message;
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
