"use client";

import { LoaderCircle, MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useSupabaseSession } from "../../lib/auth";
import { startConversation } from "../../lib/messages";
import { AuthModalPortal } from "../AuthGatedLink";

// "gözüyle'den Mesaj Gönder": ilan için konuşmayı açar (varsa mevcut olanı)
// ve sohbete geçer. Misafirde önce giriş penceresi; kendi ilanında görünmez.
export default function MessageSellerButton({
  vehicleId,
  sellerId,
  onNotice,
  className = "",
  appearance = "default",
}: {
  vehicleId: string;
  /** Biliniyorsa: kendi ilanında buton gizlenir (bilinmiyorsa sunucu reddeder) */
  sellerId?: string | null;
  /** Hata metni, çağıranın durum alanında gösterilir */
  onNotice: (message: string | null) => void;
  className?: string;
  /**
   * default: koyu dolgulu, etiket satır genişliğine göre kısalır
   * panel: masaüstü yan panelin koyu zemininde çerçeveli, tam etiket
   */
  appearance?: "default" | "panel";
}) {
  const router = useRouter();
  const { session } = useSupabaseSession();
  const [busy, setBusy] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  if (sellerId && session?.user.id === sellerId) return null;

  async function open() {
    setBusy(true);
    onNotice(null);
    try {
      const conversationId = await startConversation(vehicleId);
      router.push(`/messages/${conversationId}`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Mesajlaşma başlatılamadı.");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        aria-label="gözüyle'den mesaj gönder"
        onClick={() => (session ? void open() : setShowAuth(true))}
        className={`flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full px-2.5 text-[15px] font-semibold text-white transition-[transform,background-color] disabled:opacity-70 motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 ${
          appearance === "panel"
            ? "border border-[#3F3F46] bg-transparent hover:bg-white/5 focus-visible:ring-white"
            : "bg-[#15181C] focus-visible:ring-[#003399] focus-visible:ring-offset-2"
        } ${className}`}
      >
        {busy ? (
          <LoaderCircle aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin" />
        ) : (
          <MessageCircle aria-hidden="true" className="h-5 w-5 shrink-0" />
        )}
        {appearance === "panel" ? (
          <span aria-hidden="true">gözüyle&apos;den Mesaj Gönder</span>
        ) : (
          <>
            {/* Etiket, butonların satırının genişliğine göre (satır bir @container):
                dar telefonda kısa, genişte tam ad. Ölçüm: 320, 375, 414 px ve masaüstü */}
            <span aria-hidden="true" className="@[26rem]:hidden">
              Mesaj
            </span>
            <span aria-hidden="true" className="hidden @[26rem]:inline @[32rem]:hidden">
              Mesaj gönder
            </span>
            <span aria-hidden="true" className="hidden @[32rem]:inline">
              gözüyle&apos;den Mesaj Gönder
            </span>
          </>
        )}
      </button>
      {showAuth &&
        createPortal(
          <AuthModalPortal
            onClose={() => setShowAuth(false)}
            onAuthenticated={() => {
              setShowAuth(false);
              void open();
            }}
          />,
          document.body,
        )}
    </>
  );
}
