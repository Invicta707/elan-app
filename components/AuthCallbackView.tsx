"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AUTH_RETURN_KEY, oauthErrorMessage, safeReturnPath } from "../lib/auth-redirect";
import { supabase } from "../lib/supabase";

// Google ile girişten dönüş. Supabase istemcisi ilk kullanımda kurulurken
// adresteki oturumu (#access_token=… ya da ?code=…) kendisi işler; getSession
// bu işlemin bitmesini bekler. Sonra kullanıcı girişi başlattığı sayfaya döner.
export default function AuthCallbackView() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    function takeReturnPath(): string {
      try {
        const stored = sessionStorage.getItem(AUTH_RETURN_KEY);
        sessionStorage.removeItem(AUTH_RETURN_KEY);
        return safeReturnPath(stored);
      } catch {
        return "/";
      }
    }

    void (async () => {
      const oauthError = oauthErrorMessage(window.location.search, window.location.hash);
      if (oauthError) {
        takeReturnPath();
        if (active) setError(oauthError);
        return;
      }

      let signedIn = false;
      try {
        const { data } = await supabase.auth.getSession();
        signedIn = Boolean(data.session);
      } catch {
        // Aşağıda hata mesajı gösterilir
      }
      if (!active) return;

      if (!signedIn) {
        setError("Giriş tamamlanamadı. Tekrar dene ya da e-postayla giriş yap.");
        return;
      }
      // replace: geri tuşu bu ara sayfaya dönmesin
      router.replace(takeReturnPath());
    })();

    return () => {
      active = false;
    };
  }, [router]);

  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      {error ? (
        <>
          <p role="alert" className="text-[16px] font-semibold">
            {error}
          </p>
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-md bg-[#003399] px-5 text-[15px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
          >
            Ana sayfaya dön
          </Link>
        </>
      ) : (
        <p role="status" className="text-[16px] text-[#5B616B]">
          Giriş yapılıyor…
        </p>
      )}
    </div>
  );
}
