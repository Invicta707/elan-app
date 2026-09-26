"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { AuthModalPortal } from "./AuthGatedLink";
import { useSupabaseSession } from "../lib/auth";

// Üst çubuktaki profil butonu: misafirde giriş penceresini açar, oturum açıksa
// kullanıcının baş harfiyle avatar gösterir ve Hesabım sayfasına götürür.
export default function HeaderProfileButton({ overlay }: { overlay: boolean }) {
  const { session, isLoading } = useSupabaseSession();
  const pathname = usePathname();
  const [showAuth, setShowAuth] = useState(false);

  const base = `pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 ${
    overlay ? "focus-visible:ring-white" : "focus-visible:ring-[#003399]"
  }`;

  // Oturum bilinene kadar aynı boyutta boş bir yer tutucu: başlık kaymaz
  if (isLoading) {
    return <span aria-hidden="true" className={`${base} ${overlay ? "bg-black/35" : "bg-white"}`} />;
  }

  if (session) {
    const email = session.user.email ?? "";
    const initial = (email.trim()[0] ?? "?").toLocaleUpperCase("tr");
    const active = pathname === "/account";
    return (
      <Link
        href="/account"
        aria-label={email ? `Hesabım (${email})` : "Hesabım"}
        aria-current={active ? "page" : undefined}
        className={`${base} text-[16px] font-bold [font-family:var(--font-display)] ${
          overlay ? "bg-white text-[#0A0A0A]" : "bg-[#15181C] text-white"
        } ${active ? (overlay ? "ring-2 ring-white/60" : "ring-2 ring-[#003399]/40") : ""}`}
      >
        <span aria-hidden="true">{initial}</span>
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowAuth(true)}
        aria-haspopup="dialog"
        aria-label="Giriş yap"
        className={`${base} ${overlay ? "bg-black/35" : "bg-white"}`}
      >
        <UserIcon className="h-5 w-5" />
      </button>
      {showAuth &&
        createPortal(
          <AuthModalPortal onClose={() => setShowAuth(false)} onAuthenticated={() => setShowAuth(false)} />,
          document.body,
        )}
    </>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
