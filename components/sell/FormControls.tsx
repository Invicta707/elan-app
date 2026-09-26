"use client";

import { ChevronDown, CircleAlert } from "lucide-react";
import type { ChangeEvent, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { caretAfterDigits, groupThousands, onlyDigits } from "../../lib/listing";

// /sell form kontrolleri: etiket + alan + ipucu/hata düzeni, odak halkası,
// hatalı alan görünümü. Hata metni alanın altında, aria-describedby ile bağlı.

export const errorId = (id: string) => `${id}-error`;
export const hintId = (id: string) => `${id}-hint`;

/** Alanın aria-describedby değeri: hata varsa hata, yoksa ipucu */
export function describedBy(id: string, { error, hint }: { error?: string | null; hint?: boolean }) {
  return error ? errorId(id) : hint ? hintId(id) : undefined;
}

const BASE_CONTROL =
  "w-full rounded-xl border bg-white text-[16px] text-[#15181C] placeholder:text-[#9AA0A8] outline-none transition-[border-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:bg-[#F2F3F5] disabled:text-[#7A808A]";

export function controlClass(invalid: boolean, extra = "") {
  const state = invalid
    ? "border-[#D92D20] focus:border-[#D92D20] focus:ring-4 focus:ring-[#D92D20]/15"
    : "border-[#D5D9DF] hover:border-[#B9BFC8] focus:border-[#003399] focus:ring-4 focus:ring-[#003399]/15";
  return `${BASE_CONTROL} ${state} ${extra}`;
}

export function FieldError({ id, message }: { id: string; message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p id={errorId(id)} className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-snug text-[#B42318]">
      <CircleAlert aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
      {message}
    </p>
  );
}

export function Field({
  id,
  label,
  error,
  hint,
  optional,
  asGroup,
  className = "",
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  hint?: ReactNode;
  optional?: boolean;
  /** Radyo grubu: etiket <label> değil, grubun adı olur (id-label) */
  asGroup?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const labelContent = (
    <>
      {label}
      {optional && <span className="ml-1.5 text-[12px] font-medium text-[#8A9099]">İsteğe bağlı</span>}
    </>
  );

  return (
    <div className={className}>
      {asGroup ? (
        <span id={`${id}-label`} className="mb-1.5 block text-[14px] font-semibold text-[#15181C]">
          {labelContent}
        </span>
      ) : (
        <label htmlFor={id} className="mb-1.5 block text-[14px] font-semibold text-[#15181C]">
          {labelContent}
        </label>
      )}
      {children}
      {error ? (
        <FieldError id={id} message={error} />
      ) : (
        hint && (
          <p id={hintId(id)} className="mt-1.5 text-[13px] leading-snug text-[#5B616B]">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

type AdornedProps = { invalid: boolean; leading?: ReactNode; trailing?: ReactNode };

/** Ön/son ek (₺, km, ikon) alabilen metin alanı */
export function TextInput({
  invalid,
  leading,
  trailing,
  className = "",
  ...props
}: AdornedProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      {leading && (
        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[16px] font-semibold text-[#5B616B]">
          {leading}
        </span>
      )}
      <input
        {...props}
        aria-invalid={invalid || undefined}
        className={controlClass(invalid, `h-12 ${leading ? "pl-10" : "pl-3.5"} ${trailing ? "pr-12" : "pr-3.5"} ${className}`)}
      />
      {trailing && (
        <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[14px] font-medium text-[#5B616B]">
          {trailing}
        </span>
      )}
    </div>
  );
}

/**
 * Binlik ayraçlı sayı alanı: ekranda "1.250.000", değer (draft) yalnızca rakam.
 * İmleç, yazılan rakamın yanında kalır; ayraç silinince önündeki rakam silinir.
 */
export function GroupedNumberInput({
  value,
  onValueChange,
  maxDigits,
  ...props
}: AdornedProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "inputMode" | "type"> & {
    value: string;
    onValueChange: (digits: string) => void;
    maxDigits: number;
  }) {
  const display = groupThousands(value);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const raw = input.value;
    const caret = input.selectionStart ?? raw.length;
    let digitsBefore = onlyDigits(raw.slice(0, caret)).length;
    let next = onlyDigits(raw);

    // Yalnızca ayraç silindiyse rakamlar değişmez: silinmek istenen, ayracın yanındaki rakamdır
    const inputType = (event.nativeEvent as InputEvent).inputType;
    if (next === value && raw.length < display.length) {
      if (inputType === "deleteContentBackward" && digitsBefore > 0) {
        next = value.slice(0, digitsBefore - 1) + value.slice(digitsBefore);
        digitsBefore -= 1;
      } else if (inputType === "deleteContentForward") {
        next = value.slice(0, digitsBefore) + value.slice(digitsBefore + 1);
      }
    }

    const trimmed = next.replace(/^0+(?=\d)/, "");
    digitsBefore = Math.max(0, digitsBefore - (next.length - trimmed.length));
    next = trimmed.slice(0, maxDigits);

    // DOM'u React'ten önce güncelle: değer aynı kalınca React dokunmaz, imleç yerinde kalır
    const formatted = groupThousands(next);
    input.value = formatted;
    const position = caretAfterDigits(formatted, Math.min(digitsBefore, next.length));
    input.setSelectionRange(position, position);
    onValueChange(next);
  }

  return (
    <TextInput {...props} type="text" inputMode="numeric" autoComplete="off" value={display} onChange={handleChange} />
  );
}

export function SelectInput({
  invalid,
  className = "",
  children,
  ...props
}: { invalid: boolean } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        aria-invalid={invalid || undefined}
        className={controlClass(invalid, `h-12 appearance-none pl-3.5 pr-10 ${className}`)}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5B616B]"
      />
    </div>
  );
}

/**
 * Seçim düğmeleri (vites, yakıt, kasa, hasar). Gerçek radyo düğmeleri:
 * klavyede ok tuşlarıyla gezilir, ekran okuyucu grubu tek soru olarak okur.
 */
export function ChoiceGroup<T extends string>({
  id,
  name,
  options,
  value,
  onChange,
  invalid,
  disabled,
  columns = 2,
}: {
  id: string;
  name: string;
  options: readonly { value: T; label: string }[];
  value: T | "";
  onChange: (value: T) => void;
  invalid: boolean;
  disabled?: boolean;
  columns?: 2 | 3;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={`${id}-label`}
      aria-describedby={invalid ? errorId(id) : undefined}
      aria-invalid={invalid || undefined}
      className={`grid gap-2 ${columns === 3 ? "grid-cols-3" : "grid-cols-2"}`}
    >
      {options.map((option, index) => {
        const checked = value === option.value;
        return (
          <label key={option.value} className="relative">
            <input
              // İlk seçenek, hatalı alana odaklanmak için alanın id'sini taşır
              id={index === 0 ? id : undefined}
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span
              className={`flex h-12 cursor-pointer items-center justify-center rounded-xl border px-2 text-center text-[14px] font-semibold leading-tight transition-[border-color,background-color,box-shadow] duration-150 peer-focus-visible:ring-4 peer-focus-visible:ring-[#003399]/20 peer-disabled:cursor-not-allowed peer-disabled:opacity-60 ${
                checked
                  ? "border-[#003399] bg-[#EAEFF7] text-[#003399]"
                  : invalid
                    ? "border-[#F1B5AF] bg-white text-[#15181C] hover:border-[#D92D20]"
                    : "border-[#D5D9DF] bg-white text-[#15181C] hover:border-[#B9BFC8]"
              }`}
            >
              {option.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
