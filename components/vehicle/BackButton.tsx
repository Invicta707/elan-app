"use client";

import { useRouter } from "next/navigation";
import { shouldNavigateBack } from "../../lib/navigation";

export default function BackButton() {
  const router = useRouter();

  function handleClick() {
    if (shouldNavigateBack(document.referrer, window.location.origin, window.history.length)) {
      router.back();
    } else {
      router.push("/");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex h-11 items-center gap-1 rounded-full pr-3 pl-2 text-[15px] font-semibold text-[#15181C] hover:bg-[#E6E8EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <path d="m15 6-6 6 6 6" />
      </svg>
      Geri dön
    </button>
  );
}
