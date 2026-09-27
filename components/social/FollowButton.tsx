"use client";

import { Check, UserPlus } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import { useFollow } from "../../lib/use-follow";
import { AuthModalPortal } from "../AuthGatedLink";

export type FollowButtonVariant = "profile" | "compact" | "overlay";

// Takip Et / Takibi Bırak. İyimserdir: dokunulduğu an değişir, sunucu
// reddederse geri döner ve hata metni gösterilir. Misafirde önce giriş
// penceresi açılır, girişten sonra takip edilir. Kendi profilinde çizilmez.
export default function FollowButton({
  userId,
  variant,
  name,
  className = "",
}: {
  userId: string;
  variant: FollowButtonVariant;
  /** Ekran okuyucu için: "Kamil adlı kullanıcıyı takip et" */
  name?: string | null;
  className?: string;
}) {
  const follow = useFollow(userId);
  const [showAuth, setShowAuth] = useState(false);

  if (follow.isSelf) return null;

  async function handleClick() {
    if (follow.sessionLoading) return;
    if (!follow.viewerId) {
      setShowAuth(true);
      return;
    }
    await follow.toggle();
  }

  async function handleAuthenticated() {
    setShowAuth(false);
    const { data } = await supabase.auth.getSession();
    const viewer = data.session?.user.id;
    if (viewer && viewer !== userId) await follow.toggle(true, viewer);
  }

  return (
    <>
      <FollowButtonView
        variant={variant}
        following={follow.following}
        pending={follow.pending}
        name={name}
        onClick={handleClick}
        className={className}
      />
      {follow.error && (
        <p role="alert" className={errorClass(variant)}>
          {follow.error}
        </p>
      )}
      {showAuth &&
        createPortal(
          <AuthModalPortal onClose={() => setShowAuth(false)} onAuthenticated={() => void handleAuthenticated()} />,
          document.body,
        )}
    </>
  );
}

function errorClass(variant: FollowButtonVariant) {
  return variant === "overlay"
    ? "mt-1 basis-full rounded-md bg-black/75 px-2 py-1 text-[12px] leading-snug text-white"
    : "mt-2 basis-full text-center text-[13px] font-medium text-[#D92D20]";
}

/** Görünüm (test edilebilir): akışta takip edilen için yalnızca bir işaret, diğerlerinde aç/kapa düğmesi */
export function FollowButtonView({
  variant,
  following,
  pending = false,
  name,
  onClick,
  className = "",
}: {
  variant: FollowButtonVariant;
  following: boolean;
  pending?: boolean;
  name?: string | null;
  onClick: () => void;
  className?: string;
}) {
  const who = name ? `${name} adlı kullanıcıyı` : "Kullanıcıyı";

  if (variant === "overlay") {
    // Akışta yanlışlıkla takibi bırakmamak için takip edilen kişide düğme yok;
    // takibi bırakma profilden yapılır
    if (following) {
      return (
        <span
          className={`inline-flex h-7 items-center gap-1 rounded-full bg-white/15 px-2.5 text-[12.5px] font-semibold text-white ring-1 ring-inset ring-white/25 backdrop-blur-[2px] ${className}`}
        >
          <Check aria-hidden="true" className="h-3.5 w-3.5" />
          Takiptesin
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-label={`${who} takip et`}
        className={`pointer-events-auto inline-flex h-7 items-center gap-1 rounded-full bg-white px-3 text-[12.5px] font-bold text-[#15181C] transition-transform active:scale-95 disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${className}`}
      >
        <UserPlus aria-hidden="true" className="h-3.5 w-3.5" />
        Takip et
      </button>
    );
  }

  // Profilde yanında Mesaj ve Paylaş var: genişliği satır belirler (320 px'e sığar)
  const size = variant === "profile" ? "h-12 min-w-0 px-4 text-[15px]" : "h-9 px-4 text-[14px]";
  const tone = following
    ? "bg-[#E9ECEF] text-[#15181C] hover:bg-[#DDE1E6]"
    : "bg-[#003399] text-white hover:bg-[#002B80]";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={following}
      aria-busy={pending || undefined}
      aria-label={following ? `${who} takibi bırak` : `${who} takip et`}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-[transform,background-color] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/30 ${size} ${tone} ${className}`}
    >
      {!following && <UserPlus aria-hidden="true" className="h-4 w-4" />}
      {following ? "Takibi Bırak" : "Takip Et"}
    </button>
  );
}
