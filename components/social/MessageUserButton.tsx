"use client";

import { LoaderCircle, MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useSupabaseSession } from "../../lib/auth";
import { DIRECT_USERNAME_REQUIRED, startDirectConversation } from "../../lib/messages";
import { suggestedDisplayName } from "../../lib/profile";
import { supabase } from "../../lib/supabase";
import { useMyProfile } from "../../lib/use-my-profile";
import { suggestUsername } from "../../lib/username";
import { AuthModalPortal } from "../AuthGatedLink";
import UsernameSheet from "../profile/UsernameSheet";

// Profildeki "Mesaj": kullanıcıyla ilana bağlı olmayan sohbeti açar (varsa
// mevcut olanı) ve sohbete geçer. Misafirde önce giriş penceresi; kullanıcı
// adı yoksa önce kullanıcı adı penceresi (doğrudan sohbette iki taraf da
// @ad ile görünür; veritabanı da bunu şart koşar). Kendi profilinde çizilmez.
// Takip Et'in yanında, ona eşit genişlikte ikincil (beyaz) düğme.
export default function MessageUserButton({
  userId,
  name,
  className = "",
}: {
  userId: string;
  name?: string | null;
  className?: string;
}) {
  const router = useRouter();
  const { session } = useSupabaseSession();
  const { profile } = useMyProfile();
  const [needsUsername, setNeedsUsername] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  if (session?.user.id === userId) return null;

  function start() {
    if (profile && !profile.username) setNeedsUsername(true);
    else void open();
  }

  async function open() {
    setBusy(true);
    setError(null);
    try {
      router.push(`/messages/${await startDirectConversation(userId)}`);
    } catch (err) {
      setBusy(false);
      const message = err instanceof Error ? err.message : "Mesajlaşma başlatılamadı.";
      // Profil henüz yüklenmemişken (ör. girişten hemen sonra) sunucu söyler
      if (message === DIRECT_USERNAME_REQUIRED) setNeedsUsername(true);
      else setError(message);
    }
  }

  return (
    <>
      <MessageUserButtonView
        busy={busy}
        name={name}
        className={className}
        onClick={() => (session ? start() : setShowAuth(true))}
      />
      {error && (
        <p role="alert" className="mt-2 basis-full text-center text-[13px] font-medium text-[#D92D20]">
          {error}
        </p>
      )}
      {needsUsername && session && (
        <UsernameSheet
          mode="onboarding"
          intro="Profilden mesaj göndermek için önce bir kullanıcı adı seç; karşı taraf seni bu adla görür."
          initialValue={suggestUsername(
            profile?.displayName ?? suggestedDisplayName(session.user.user_metadata),
            session.user.email,
          )}
          onClose={() => setNeedsUsername(false)}
          onSaved={() => {
            setNeedsUsername(false);
            void open();
          }}
        />
      )}
      {showAuth &&
        createPortal(
          <AuthModalPortal
            onClose={() => setShowAuth(false)}
            onAuthenticated={async () => {
              setShowAuth(false);
              // Giriş yapılan hesap bu profilin sahibiyse sohbet açılmaz
              const { data } = await supabase.auth.getSession();
              if (data.session?.user.id !== userId) void open();
            }}
          />,
          document.body,
        )}
    </>
  );
}

/** Görünüm (test edilebilir) */
export function MessageUserButtonView({
  busy = false,
  name,
  className = "",
  onClick,
}: {
  busy?: boolean;
  name?: string | null;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      aria-label={name ? `${name} adlı kullanıcıya mesaj gönder` : "Mesaj gönder"}
      className={`inline-flex h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl bg-white px-4 text-[15px] font-semibold text-[#15181C] shadow-[0_1px_2px_rgba(16,24,40,0.06)] ring-1 ring-inset ring-[#D5D9DF] transition-[transform,background-color] duration-150 hover:bg-[#F7F8FA] active:scale-[0.97] disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] ${className}`}
    >
      {busy ? (
        <LoaderCircle aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />
      ) : (
        <MessageCircle aria-hidden="true" className="h-4 w-4" />
      )}
      Mesaj
    </button>
  );
}
