"use client";

import { LoaderCircle, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { EMPTY_FILTERS, type Catalog, type SearchFilters } from "../../lib/search";
import type { HomeFilters } from "../../lib/use-home-filters";
import FilterSheet from "../search/FilterSheet";

// Mobil akışın sol üstünde, başlığın hemen altında küçük "Filtrele" hapı
// (başlıktaki düğmelerle aynı yarı saydam koyu zemin). Dokununca filtre
// penceresi alttan açılır; video arkada oynamaya devam eder. Filtre
// uygulanınca hap sayıyı gösterir, yanındaki ✕ tek dokunuşla temizler.

const EMPTY_CATALOG: Catalog = { brands: [], models: [] };

// Görünen hap 32 px; dokunma alanı before ile 44 px'e genişler (başlığın düğmelerine değmez)
const pillClass =
  "pointer-events-auto relative inline-flex h-8 items-center gap-1.5 rounded-full bg-black/35 text-[13px] font-semibold text-white ring-1 ring-inset ring-white/15 backdrop-blur-[6px] before:absolute before:-inset-y-1.5 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

export default function FeedFilterButton({
  home,
  onApply,
}: {
  home: HomeFilters;
  onApply: (next: SearchFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const count = home.activeCount;

  async function handleOpen() {
    if (opening) return;
    // Marka/model listesi henüz gelmediyse önce o (genelde akışla birlikte önceden yüklenir)
    if (!home.catalog) {
      setOpening(true);
      await home.loadCatalog();
      setOpening(false);
    }
    setOpen(true);
  }

  return (
    <>
      {/* Başlıkla aynı genişlikte: mobilde video sütunu, md'de tam genişlik (logoyla hizalı) */}
      <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+3.75rem)] z-30 mx-auto flex max-w-[calc(100dvh*9/16)] items-center gap-1.5 px-3 md:max-w-none md:px-5">
        <button
          type="button"
          onClick={() => void handleOpen()}
          aria-haspopup="dialog"
          aria-busy={opening}
          aria-label={count > 0 ? `Filtreler, ${count} filtre uygulandı` : "Filtrele"}
          className={`${pillClass} pr-3 pl-2.5 before:inset-x-0`}
        >
          {opening ? (
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
          )}
          <span aria-hidden="true">{count > 0 ? "Filtreler" : "Filtrele"}</span>
          {count > 0 && (
            <span
              aria-hidden="true"
              className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-white px-1 text-[11.5px] font-bold text-[#121212]"
            >
              {count}
            </span>
          )}
        </button>
        {count > 0 && home.filters && (
          <button
            type="button"
            onClick={() => onApply({ ...EMPTY_FILTERS, sort: home.filters?.sort ?? "newest" })}
            aria-label="Filtreleri temizle"
            className={`${pillClass} w-8 justify-center before:-inset-x-1.5`}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (
        <FilterSheet
          catalog={home.catalog ?? EMPTY_CATALOG}
          filters={home.filters ?? EMPTY_FILTERS}
          submitLabel="Videoları göster"
          showVideoOnly={false}
          onClose={() => setOpen(false)}
          onApply={(next) => {
            setOpen(false);
            onApply(next);
          }}
        />
      )}
    </>
  );
}

/** Filtreli akışta hiç video yoksa (akışın boş durumu, koyu kart) */
export function FilteredFeedEmpty({ onClear }: { onClear: () => void }) {
  return (
    <div className="my-auto flex w-full max-w-sm flex-col items-center gap-3.5 rounded-3xl bg-[#18181B] px-5 py-6 text-center text-white ring-1 ring-inset ring-[#27272A] motion-safe:animate-[fade-in_240ms_ease-out]">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#27272A] text-white/90">
        <SlidersHorizontal aria-hidden="true" className="h-6 w-6" />
      </span>
      <div>
        <p className="text-[18px] font-semibold leading-snug">Bu filtrelere uyan video yok.</p>
        <p className="mt-1.5 text-[15px] leading-relaxed text-[#A1A1AA]">
          Fiyat ya da yıl aralığını genişletmeyi veya bir filtreyi kaldırmayı dene.
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="mt-1 h-12 w-full rounded-2xl bg-white text-[16px] font-semibold text-[#121212] transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#18181B]"
      >
        Filtreleri temizle
      </button>
    </div>
  );
}
