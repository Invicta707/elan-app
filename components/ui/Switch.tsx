"use client";

import { useId } from "react";

// Aç/kapa anahtarı (role="switch"): satırın tamamı dokunulabilir, durum
// ekran okuyucuya aria-checked ile söylenir. Açıkken marka mavisi.
export default function Switch({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      aria-describedby={description ? `${id}-desc` : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#F7F8FA] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#003399]"
    >
      <span className="min-w-0 flex-1">
        <span id={`${id}-label`} className="block text-[15.5px] font-semibold text-[#15181C]">
          {label}
        </span>
        {description && (
          <span id={`${id}-desc`} className="block text-[13px] leading-snug text-[#5B616B]">
            {description}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 ${
          checked ? "bg-[#003399]" : "bg-[#D5D9DF]"
        }`}
      >
        <span
          className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-[left] duration-200 ${
            checked ? "left-[23px]" : "left-[3px]"
          }`}
        />
      </span>
    </button>
  );
}
