import FeedHeader from "../../components/FeedHeader";
import { bodyFont, displayFont } from "../fonts";

// "Ara"ya dokunulduğu an gösterilen iskelet. Sayfa ilk sonuçları sunucuda
// hazırlarken (katalog + arama) gezinme beklemez: Next.js bu iskeleti önceden
// indirir ve geçişte hemen çizer, sonuçlar gelince yerini SearchView alır.
// Yerleşim SearchView'la aynı: arama kutusu, Filtreler, 2/3/4 sütunlu ızgara.
export default function SearchLoading() {
  return (
    <main
      data-search-skeleton=""
      aria-busy="true"
      className={`${displayFont.variable} ${bodyFont.variable} min-h-dvh w-full bg-[#F2F3F5] text-[#15181C] [font-family:var(--font-body)]`}
    >
      <div className="sticky top-0 z-20 border-b border-[#D9DDE3] bg-[#F2F3F5]/95 backdrop-blur-[6px]">
        <FeedHeader activeTab="search" tone="solid" />
        <div className="mx-auto flex max-w-5xl gap-2 px-4 pb-3">
          <div className="flex h-11 flex-1 items-center gap-2 rounded-md border border-[#C9CED6] bg-white px-3 text-base text-[#7A808A]">
            <SearchIcon className="h-5 w-5 shrink-0" />
            Marka veya model ara
          </div>
          <div className="h-11 w-[7.5rem] shrink-0 rounded-md border border-[#15181C] bg-white" />
        </div>
      </div>

      <section
        aria-label="Arama sonuçları yükleniyor"
        className="mx-auto max-w-5xl px-4 pt-4 pb-[max(2.5rem,calc(var(--bottom-nav-height)+1.5rem),env(safe-area-inset-bottom))]"
      >
        <p role="status" className="sr-only">
          İlanlar yükleniyor
        </p>
        <div aria-hidden="true" className="mb-4 h-9 w-40 rounded-md bg-[#E3E6EA] motion-safe:animate-pulse" />
        <ul aria-hidden="true" className="grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="motion-safe:animate-pulse">
              <div className="aspect-[4/5] w-full rounded-lg bg-[#E3E6EA]" />
              <div className="mt-2.5 h-4 w-3/4 rounded bg-[#E3E6EA]" />
              <div className="mt-2 h-5 w-1/2 rounded bg-[#DDE1E6]" />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function SearchIcon({ className }: { className?: string }) {
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
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}
