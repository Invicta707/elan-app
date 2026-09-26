"use client";

import { PartyPopper } from "lucide-react";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { saveUsername } from "../../lib/profile";
import { useUsernameCheck } from "../../lib/use-username-check";
import { updateMyProfile } from "../../lib/use-my-profile";
import { profilePath } from "../../lib/username";
import BottomSheet from "../ui/BottomSheet";
import UsernameField from "./UsernameField";

// Kullanıcı adı belirleme (giriş sonrası, kullanıcı adı yoksa) ve değiştirme
// (Vitrinim). Kaydetme set_username RPC'siyle; kurallar veritabanında.
export default function UsernameSheet({
  mode,
  initialValue,
  onClose,
}: {
  mode: "onboarding" | "edit";
  initialValue: string;
  onClose: () => void;
}) {
  const inputId = useId();
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const check = useUsernameCheck(value);

  // Sunucuya ulaşılamadıysa (error) kaydetme yine denenebilir: sonucu sunucu söyler
  const canSave = !saving && (check === "available" || check === "error");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (check === "current") return onClose();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const username = await saveUsername(value);
      updateMyProfile({ username });
      if (mode === "onboarding") setSaved(username);
      else onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kullanıcı adı kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <BottomSheet title="Kullanıcı adın hazır" onClose={onClose} closeLabel="Tamam">
        <div className="flex flex-col items-center px-6 pb-2 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#ECFDF3] text-[#067647] motion-safe:animate-[badge-pop_320ms_cubic-bezier(0.34,1.56,0.64,1)]">
            <PartyPopper aria-hidden="true" className="h-8 w-8" />
          </span>
          <p className="mt-3 text-[20px] font-semibold [font-family:var(--font-display)]">@{saved}</p>
          <p className="mt-1 max-w-xs text-[14px] text-[#5B616B]">
            Vitrinin artık gozuyle.com/@{saved} adresinde. Alıcılar seni bu adla bulup takip edebilir.
          </p>
          <Link
            href={profilePath(saved)}
            onClick={onClose}
            className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-[#003399] text-[16px] font-semibold text-white transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/30"
          >
            Vitrinimi gör
          </Link>
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      title={mode === "onboarding" ? "Kullanıcı adını belirle" : "Kullanıcı adını değiştir"}
      onClose={onClose}
      closeLabel={mode === "onboarding" ? "Daha sonra" : "Vazgeç"}
    >
      <form onSubmit={handleSubmit} noValidate className="px-5 pb-2">
        {mode === "onboarding" ? (
          <p className="mb-4 text-center text-[14px] leading-relaxed text-[#5B616B]">
            Vitrinin <span className="font-semibold text-[#15181C]">gozuyle.com/@{value || "kullanici_adi"}</span> adresinde
            yayında olacak. Alıcılar seni bu adla bulup takip edebilir.
          </p>
        ) : (
          <p className="mb-4 text-center text-[14px] leading-relaxed text-[#5B616B]">
            Eski adresin çalışmaz olur. Kullanıcı adını 7 günde bir değiştirebilirsin.
          </p>
        )}
        <UsernameField
          id={inputId}
          value={value}
          autoFocus
          onChange={(next) => {
            setValue(next);
            setError(null);
          }}
          check={check}
          error={error}
        />
        <button
          type="submit"
          disabled={!canSave && check !== "current"}
          aria-busy={saving || undefined}
          className="mt-3 h-12 w-full rounded-2xl bg-[#003399] text-[16px] font-semibold text-white transition-[transform,opacity] active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/30"
        >
          {saving ? "Kaydediliyor…" : check === "current" ? "Kapat" : "Kaydet"}
        </button>
      </form>
    </BottomSheet>
  );
}
