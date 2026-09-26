"use client";

import { AtSign, CircleAlert, CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import type { UsernameCheck } from "../../lib/use-username-check";
import { USERNAME_MAX, USERNAME_MIN, USERNAME_STATUS_MESSAGES, sanitizeUsernameInput } from "../../lib/username";
import { controlClass } from "../sell/FormControls";

type Tone = "neutral" | "ok" | "bad";

/** Durumun metni, rengi ve simgesi */
export function describeUsernameCheck(value: string, check: UsernameCheck): { tone: Tone; text: string } {
  switch (check) {
    case "idle":
      return { tone: "neutral", text: `${USERNAME_MIN}–${USERNAME_MAX} karakter; küçük harf, rakam ve alt çizgi (_).` };
    case "checking":
      return { tone: "neutral", text: "Kontrol ediliyor…" };
    case "error":
      return { tone: "neutral", text: "Kontrol edilemedi; kaydederken yeniden denenecek." };
    case "invalid":
      // Karakterler zaten süzülüyor: geçersizlik yalnızca kısalıktan
      return value.length < USERNAME_MIN
        ? { tone: "neutral", text: `En az ${USERNAME_MIN} karakter yaz.` }
        : { tone: "bad", text: USERNAME_STATUS_MESSAGES.invalid };
    case "available":
      return { tone: "ok", text: `@${value} müsait.` };
    case "current":
      return { tone: "ok", text: USERNAME_STATUS_MESSAGES.current };
    default:
      return { tone: "bad", text: USERNAME_STATUS_MESSAGES[check] };
  }
}

// @ önekli kullanıcı adı alanı: yazılanı kurala göre süzer (Ş → s, boşluk → _),
// sağ uçta canlı kontrolün simgesi (yeşil tik / kırmızı çarpı / dönen halka).
export default function UsernameField({
  id,
  value,
  onChange,
  check,
  error,
  autoFocus = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  check: UsernameCheck;
  /** Kaydetme hatası (sunucudan) */
  error?: string | null;
  autoFocus?: boolean;
}) {
  const state = describeUsernameCheck(value, check);
  const tone: Tone = error ? "bad" : state.tone;
  const text = error ?? state.text;
  const statusId = `${id}-status`;

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[14px] font-semibold">
        Kullanıcı adı
      </label>
      <div className="relative">
        <AtSign aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#8A9099]" />
        <input
          id={id}
          value={value}
          autoFocus={autoFocus}
          onChange={(event) => onChange(sanitizeUsernameInput(event.target.value))}
          maxLength={USERNAME_MAX}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          spellCheck={false}
          enterKeyHint="done"
          aria-invalid={tone === "bad" ? true : undefined}
          aria-describedby={statusId}
          className={controlClass(tone === "bad", "h-12 pl-10 pr-11 text-[16px] font-medium")}
        />
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2">
          <StatusIcon check={check} tone={tone} />
        </span>
      </div>
      <p
        id={statusId}
        aria-live="polite"
        className={`mt-1.5 min-h-[1.25rem] text-[13px] leading-snug ${
          tone === "ok" ? "font-medium text-[#067647]" : tone === "bad" ? "font-medium text-[#B42318]" : "text-[#5B616B]"
        }`}
      >
        {text}
      </p>
    </div>
  );
}

function StatusIcon({ check, tone }: { check: UsernameCheck; tone: Tone }) {
  if (check === "checking") {
    return <LoaderCircle aria-hidden="true" className="h-5 w-5 text-[#8A9099] motion-safe:animate-spin" />;
  }
  if (tone === "ok") return <CircleCheck aria-label="Müsait" className="h-5 w-5 text-[#12B76A]" />;
  if (tone === "bad") return <CircleX aria-label="Kullanılamaz" className="h-5 w-5 text-[#D92D20]" />;
  if (check === "error") return <CircleAlert aria-hidden="true" className="h-5 w-5 text-[#8A9099]" />;
  return null;
}
