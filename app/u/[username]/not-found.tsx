import Link from "next/link";
import { bodyFont, displayFont } from "../../fonts";

// Olmayan ya da adı değişmiş kullanıcının /@kullanici_adi bağlantısı
export default function ProfileNotFound() {
  return (
    <main
      className={`${displayFont.variable} ${bodyFont.variable} flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-[#F2F3F5] px-6 pb-[var(--bottom-nav-height)] text-center text-[#15181C] [font-family:var(--font-body)]`}
    >
      <h1 className="text-[26px] font-semibold [font-family:var(--font-display)]">Bu kullanıcı bulunamadı</h1>
      <p className="max-w-sm text-[15px] text-[#5B616B]">
        Kullanıcı adı değişmiş ya da hesap kapatılmış olabilir.
      </p>
      <div className="flex gap-3">
        <Link
          href="/search"
          className="h-12 rounded-md bg-[#003399] px-5 text-[16px] font-semibold leading-[3rem] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
        >
          İlanlara göz at
        </Link>
        <Link
          href="/"
          className="h-12 rounded-md border border-[#15181C] bg-white px-5 text-[16px] font-semibold leading-[3rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
        >
          Akışa dön
        </Link>
      </div>
    </main>
  );
}
