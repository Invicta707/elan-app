"use client";

import { useId, useState, type FormEvent } from "react";
import { DISPLAY_NAME_MAX, displayNameError, saveDisplayName } from "../../lib/profile";
import { updateMyProfile } from "../../lib/use-my-profile";
import { FieldError, controlClass } from "../sell/FormControls";
import BottomSheet from "../ui/BottomSheet";

// Görünen ad: mesajlarda karşı tarafa bu ad görünür (e-posta asla görünmez).
export default function EditNameSheet({
  userId,
  initialName,
  onClose,
}: {
  userId: string;
  initialName: string;
  onClose: () => void;
}) {
  const inputId = useId();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = displayNameError(name);
    if (problem) return setError(problem);
    setSaving(true);
    try {
      updateMyProfile({ displayName: await saveDisplayName(userId, name) });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ad kaydedilemedi.");
      setSaving(false);
    }
  }

  return (
    <BottomSheet title="Görünen ad" onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate className="px-5 pb-2">
        <label htmlFor={inputId} className="mb-1.5 block text-[14px] font-semibold">
          Adın
        </label>
        <input
          id={inputId}
          autoFocus
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="nickname"
          value={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : `${inputId}-hint`}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          className={controlClass(Boolean(error), "h-12 px-3.5")}
        />
        {error ? (
          <FieldError id={inputId} message={error} />
        ) : (
          <p id={`${inputId}-hint`} className="mt-1.5 text-[13px] text-[#5B616B]">
            Mesajlaştığın kişiler seni bu adla görür.
          </p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="mt-4 h-12 w-full rounded-2xl bg-[#003399] text-[16px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/30"
        >
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </form>
    </BottomSheet>
  );
}
