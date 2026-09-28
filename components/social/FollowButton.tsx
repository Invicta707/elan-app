"use client";

import { Check, UserPlus } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import { useFollow } from "../../lib/use-follow";
import { AuthModalPortal } from "../AuthGatedLink";

/** panel: masaüstü yan panelin koyu zemininde (compact boyutunda) */
export type FollowButtonVariant = "profile" | "compact" | "overlay" | "panel";

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
  if (variant === "overlay") return "mt-1 basis-full rounded-md bg-black/75 px-2 py-1 text-[12px] leading-snug text-white";
  if (variant === "panel") return "mt-2 basis-full text-[13px] font-medium text-[#FCA5A5]";
  return "mt-2 basis-full text-center text-[13px] font-medium text-[#D92D20]";
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
          className={`inline-flex h-6 items-center gap-1 rounded-full bg-black/30 px-2 text-[12px] font-medium text-white ring-1 ring-inset ring-white/15 backdrop-blur-[6px] ${className}`}
        >
          <Check aria-hidden="true" className="h-3 w-3" />
          Takiptesin
        </span>
      );
    }
    // Görünen etiket küçük; dokunma alanı dikeyde genişletilir (before: -inset-y)
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-label={`${who} takip et`}
        className={`pointer-events-auto relative inline-flex h-6 items-center gap-1 rounded-full bg-white px-2.5 text-[12px] font-semibold text-[#15181C] transition-transform before:absolute before:-inset-y-2.5 before:-inset-x-1 before:content-[''] active:scale-95 disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${className}`}
      >
        <UserPlus aria-hidden="true" className="h-3 w-3" />
        Takip et
      </button>
    );
  }

  // Profilde yanında Mesaj ve Paylaş var: genişliği satır belirler (320 px'e sığar)
  const size = variant === "profile" ? "h-12 min-w-0 px-4 text-[15px]" : "h-9 px-4 text-[14px]";
  const dark = variant === "panel";
  const tone = following
    ? dark
      ? "bg-[#27272A] text-white hover:bg-[#3F3F46]"
      : "bg-[#E9ECEF] text-[#15181C] hover:bg-[#DDE1E6]"
    : "bg-[#003399] text-white hover:bg-[#002B80]";
  const ring = dark ? "focus-visible:ring-2 focus-visible:ring-white" : "focus-visible:ring-4 focus-visible:ring-[#003399]/30";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={following}
      aria-busy={pending || undefined}
      aria-label={following ? `${who} takibi bırak` : `${who} takip et`}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-[transform,background-color] duration-150 active:scale-[0.97] focus-visible:outline-none ${ring} ${size} ${tone} ${className}`}
    >
      {!following && <UserPlus aria-hidden="true" className="h-4 w-4" />}
      {following ? "Takibi Bırak" : "Takip Et"}
    </button>
  );
}
