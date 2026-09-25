"use client";

export default function WhatsAppButton({
  onClick,
  isContacting,
  className = "",
}: {
  onClick: () => void;
  isContacting: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isContacting}
      aria-busy={isContacting}
      className={`flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#25D366] px-3 text-[15px] font-semibold text-[#062612] disabled:opacity-70 motion-safe:transition-transform motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15181C] focus-visible:ring-offset-2 ${className}`}
    >
      <ChatIcon className="h-5 w-5 shrink-0" />
      {isContacting ? "Açılıyor…" : "WhatsApp'tan yaz"}
    </button>
  );
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.55L3.5 20.5l1.45-4.35A8.5 8.5 0 1 1 20.5 11.5Z" />
    </svg>
  );
}
