"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { bodyFont, displayFont } from "../app/fonts";
import { useSupabaseSession } from "../lib/auth";
import AuthModal from "./AuthModal";

type AuthGatedLinkProps = {
  href: string;
  className: string;
  children: ReactNode;
  "aria-label"?: string;
  "aria-current"?: "page";
};

// Giriş gerektiren sayfaya giden bağlantı (ör. "+ İlan Ver"). Oturum varsa düz
// bağlantıdır; misafirde giriş penceresini açar ve giriş yapılınca sayfaya
// geçer. Oturum henüz bilinmiyorken (ve sunucuda) bağlantı olarak çizilir:
// hidrasyon uyumlu kalır, hedef sayfa kendi kontrolünü yine yapar.
export default function AuthGatedLink({ href, className, children, ...aria }: AuthGatedLinkProps) {
  const { session, isLoading } = useSupabaseSession();
  const router = useRouter();
  const [showAuth, setShowAuth] = useState(false);

  if (session || isLoading) {
    return (
      <Link href={href} className={className} {...aria}>
        {children}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowAuth(true)}
        aria-haspopup="dialog"
        className={className}
        {...aria}
      >
        {children}
      </button>
      {showAuth &&
        createPortal(
          <AuthModalPortal
            onClose={() => setShowAuth(false)}
            onAuthenticated={() => {
              setShowAuth(false);
              router.push(href);
            }}
            // Google ile girişte sayfadan çıkılır; dönüşte doğrudan hedefe gidilir
            oauthReturnTo={href}
          />,
          document.body,
        )}
    </>
  );
}

/**
 * Giriş penceresi body'ye taşınır: akış başlığı pointer-events-none olduğu için
 * içinde çizilen pencere tıklanamazdı. Yazı tipleri sayfanın <main>'inden
 * gelmediği için burada verilir.
 */
export function AuthModalPortal(props: {
  onClose: () => void;
  onAuthenticated: () => void;
  oauthReturnTo?: string;
}) {
  return (
    <div className={`${displayFont.variable} ${bodyFont.variable} [font-family:var(--font-body)]`}>
      <AuthModal {...props} />
    </div>
  );
}
