import { Compass, LogIn, UsersRound } from "lucide-react";

export type FollowingEmptyKind = "guest" | "none" | "quiet";

const COPY: Record<FollowingEmptyKind, { title: string; body: string }> = {
  guest: {
    title: "Takip ettiklerin burada",
    body: "Satıcıları takip etmek ve yeni videolarını burada görmek için giriş yap.",
  },
  none: {
    title: "Henüz kimseyi takip etmiyorsun.",
    body: "İlgini çeken satıcıları vitrinlerinden takip et!",
  },
  quiet: {
    title: "Şimdilik yeni video yok",
    body: "Takip ettiğin satıcıların yayında videolu ilanı yok. Yeni video yüklediklerinde burada göreceksin.",
  },
};

// "Takip Edilenler" sekmesinin boş durumu (siyah akış zemininde cam kart)
export default function FollowingEmpty({
  kind,
  onExplore,
  onSignIn,
}: {
  kind: FollowingEmptyKind;
  onExplore: () => void;
  onSignIn?: () => void;
}) {
  const copy = COPY[kind];
  const Icon = kind === "guest" ? LogIn : UsersRound;

  return (
    <div className="my-auto flex w-full max-w-sm flex-col items-center gap-3.5 rounded-3xl bg-[#18181B] px-5 py-6 text-center text-white ring-1 ring-inset ring-[#27272A] motion-safe:animate-[fade-in_240ms_ease-out]">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#27272A] text-white/90">
        <Icon aria-hidden="true" className="h-6 w-6" />
      </span>
      <div>
        <p className="text-[18px] font-semibold leading-snug">{copy.title}</p>
        <p className="mt-1.5 text-[15px] leading-relaxed text-[#A1A1AA]">{copy.body}</p>
      </div>
      <div className="mt-1 flex w-full flex-col gap-2.5">
        {kind === "guest" && onSignIn && (
          <button
            type="button"
            onClick={onSignIn}
            className="h-12 w-full rounded-2xl bg-white text-[16px] font-semibold text-[#121212] transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#18181B]"
          >
            Giriş yap
          </button>
        )}
        <button
          type="button"
          onClick={onExplore}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#27272A] text-[16px] font-semibold text-white transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#18181B]"
        >
          <Compass aria-hidden="true" className="h-5 w-5" />
          Keşfet&apos;e dön
        </button>
      </div>
    </div>
  );
}
