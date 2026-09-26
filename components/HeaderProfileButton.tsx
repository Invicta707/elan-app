"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { AuthModalPortal } from "./AuthGatedLink";
import { useSupabaseSession } from "../lib/auth";
import { useMyProfile } from "../lib/use-my-profile";
import { useUnreadCount } from "../lib/use-unread-count";
import Avatar from "./ui/Avatar";
import UnreadBadge from "./ui/UnreadBadge";

// Üst çubuktaki profil butonu: misafirde giriş penceresini açar; oturum açıksa
// profil fotoğrafını (yoksa baş harf) ve okunmamış mesaj rozetini gösterir,
// Vitrinim'e (profil) götürür.
export default function HeaderProfileButton({ overlay }: { overlay: boolean }) {
  const { session, isLoading } = useSupabaseSession();
  const { profile } = useMyProfile();
  const unread = useUnreadCount();
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
    const name = profile?.displayName ?? email;
    const active = pathname === "/my-listings" || pathname === "/account";
    return (
      <Link
        href="/my-listings"
        aria-label={profile?.displayName ? `Vitrinim (${profile.displayName})` : "Vitrinim"}
        aria-current={active ? "page" : undefined}
        className={`${base} relative transition-transform active:scale-95 ${
          active ? (overlay ? "ring-2 ring-white/70" : "ring-2 ring-[#003399]/50") : ""
        }`}
      >
        <Avatar url={profile?.avatarUrl} name={name} size={40} className={overlay ? "ring-2 ring-white/80" : ""} />
        <UnreadBadge count={unread} className="absolute -right-1 -top-1" />
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
