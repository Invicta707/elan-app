"use client";

import { Camera, ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AvatarImageError, compressAvatar } from "../../lib/avatar-image";
import { removeAvatar, uploadAvatar } from "../../lib/profile";
import { supabase } from "../../lib/supabase";
import { updateMyProfile } from "../../lib/use-my-profile";
import Avatar from "../ui/Avatar";
import BottomSheet from "../ui/BottomSheet";

// Profil fotoğrafı: dokununca (fotoğraf varsa önce menü) dosya seçilir,
// tarayıcıda ortadan kare kırpılıp 512 px WebP'ye sıkıştırılır, yuvarlak
// önizlemede onaylanınca sunucuya gider.

type Step = { kind: "idle" } | { kind: "menu" } | { kind: "preview"; blob: Blob; url: string } | { kind: "busy" };

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export default function AvatarPicker({
  avatarUrl,
  name,
  size = 88,
}: {
  avatarUrl: string | null;
  name: string | null;
  size?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  // Önizleme adresi, önizleme kapanınca serbest bırakılır
  useEffect(() => {
    if (step.kind !== "preview") return;
    return () => URL.revokeObjectURL(step.url);
  }, [step]);

  function pickFile() {
    setStep({ kind: "idle" });
    inputRef.current?.click();
  }

  async function handleFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    setStep({ kind: "busy" });
    try {
      const blob = await compressAvatar(file);
      setStep({ kind: "preview", blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      setStep({ kind: "idle" });
      setError(err instanceof AvatarImageError ? err.message : "Fotoğraf hazırlanamadı.");
    }
  }

  async function save(blob: Blob) {
    setStep({ kind: "busy" });
    const token = await accessToken();
    const result = token ? await uploadAvatar(blob, token) : { ok: false as const, message: "Oturumun kapanmış; tekrar giriş yap." };
    setStep({ kind: "idle" });
    if (result.ok) updateMyProfile({ avatarUrl: result.avatarUrl });
    else setError(result.message);
  }

  async function remove() {
    setStep({ kind: "busy" });
    const token = await accessToken();
    const result = token ? await removeAvatar(token) : { ok: false as const, message: "Oturumun kapanmış; tekrar giriş yap." };
    setStep({ kind: "idle" });
    if (result.ok) updateMyProfile({ avatarUrl: null });
    else setError(result.message);
  }

  const busy = step.kind === "busy";

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        disabled={busy}
        onClick={() => (avatarUrl ? setStep({ kind: "menu" }) : pickFile())}
        aria-label={avatarUrl ? "Profil fotoğrafını değiştir" : "Profil fotoğrafı ekle"}
        className="group relative rounded-full transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/30"
      >
        <span className="block rounded-full bg-[#E4E4E7] p-px">
          <span className="block rounded-full bg-white p-[3px]">
            <Avatar url={avatarUrl} name={name} size={size} />
          </span>
        </span>
        <span className="absolute bottom-0.5 right-0.5 flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-white bg-[#18181B] text-white">
          {busy ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Camera aria-hidden="true" className="h-4 w-4" />}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <div role="status" aria-live="polite">
        {error && <p className="mt-2 max-w-[16rem] text-center text-[13px] text-[#B42318]">{error}</p>}
      </div>

      {step.kind === "menu" && (
        <BottomSheet
          title="Profil fotoğrafı"
          onClose={() => setStep({ kind: "idle" })}
          actions={[
            { label: "Yeni fotoğraf seç", icon: <ImagePlus className="h-5 w-5" />, onSelect: pickFile },
            { label: "Fotoğrafı kaldır", icon: <Trash2 className="h-5 w-5" />, tone: "danger", onSelect: () => void remove() },
          ]}
        />
      )}

      {step.kind === "preview" && (
        <BottomSheet title="Önizleme" onClose={() => setStep({ kind: "idle" })}>
          <div className="flex flex-col items-center px-5 pb-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- yerel object URL */}
            <img
              src={step.url}
              alt="Yeni profil fotoğrafının önizlemesi"
              className="h-52 w-52 rounded-full object-cover shadow-[0_8px_24px_rgba(16,24,40,0.18)] ring-4 ring-white motion-safe:animate-[fade-in_200ms_ease-out]"
            />
            <p className="mt-3 text-center text-[13px] text-[#5B616B]">Fotoğrafın ortası kare olarak kırpıldı.</p>
            <button
              type="button"
              onClick={() => void save(step.blob)}
              className="mt-4 h-12 w-full rounded-2xl bg-[#003399] text-[16px] font-semibold text-white transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/30"
            >
              Profil fotoğrafı yap
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
