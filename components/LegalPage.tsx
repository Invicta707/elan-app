import Link from "next/link";
import type { ReactNode } from "react";
import { bodyFont, displayFont } from "../app/fonts";
import { LEGAL_CONTACT_EMAIL, LEGAL_LAST_UPDATED } from "../lib/legal";
import BackButton from "./vehicle/BackButton";

// /privacy ve /terms için sade metin sayfası. Başlıklar (h2), paragraflar ve
// listeler buradaki stillerle biçimlenir; sayfalar sadece metni yazar.
export default function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main
      className={`${displayFont.variable} ${bodyFont.variable} min-h-dvh w-full bg-[#F2F3F5] text-[#15181C] [font-family:var(--font-body)]`}
    >
      <div className="mx-auto max-w-2xl px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[calc(3rem+var(--bottom-nav-height))]">
        <div className="-ml-2 flex h-14 items-center">
          <BackButton />
        </div>

        <h1 className="text-[28px] font-semibold leading-tight [font-family:var(--font-display)]">{title}</h1>
        <p className="mt-1 text-[14px] text-[#5B616B]">Son güncelleme: {LEGAL_LAST_UPDATED}</p>

        <article className="mt-6 text-[15px] leading-relaxed text-[#2A2F36] [&_a]:font-semibold [&_a]:text-[#003399] [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-[19px] [&_h2]:font-semibold [&_h2]:text-[#15181C] [&_h2]:[font-family:var(--font-display)] [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
          {children}

          <h2>İletişim</h2>
          <p>
            Sorularını ve taleplerini <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a> adresine
            iletebilirsin.
          </p>
        </article>

        <nav aria-label="Yasal metinler" className="mt-10 flex gap-5 border-t border-[#E3E6EA] pt-4 text-[14px]">
          <Link href="/terms" className="font-semibold text-[#003399] hover:underline">
            Kullanım Koşulları
          </Link>
          <Link href="/privacy" className="font-semibold text-[#003399] hover:underline">
            Gizlilik Politikası
          </Link>
        </nav>
      </div>
    </main>
  );
}
