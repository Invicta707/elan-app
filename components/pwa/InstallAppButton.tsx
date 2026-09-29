"use client";

import { Download, X } from "lucide-react";
import { useState } from "react";
import { dismissInstall, promptInstall, useInstallPrompt } from "../../lib/install-prompt";

// Mobil akışta "Uygulamayı yükle" hapı: "Filtrele" hapının hemen altında, aynı
// yarı saydam koyu zeminde, sol üstte. Videonun üstünde yalnızca hap kadar yer
// kaplar; video durmaz, sağ düğme sütununa ve alt bilgi şeridine değmez.
// Tarayıcı kurulum olayını göndermediyse (iOS, kurulu, 7 gün içinde reddedildi)
// hiç çizilmez (lib/install-prompt.ts).

// FeedFilterButton'daki hapla aynı görünüm; 32 px hap, dokunma alanı before ile 44 px
const pillPart =
  "relative inline-flex h-8 items-center text-white before:absolute before:-inset-y-1.5 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

export default function InstallAppButton() {
  const visible = useInstallPrompt();
  const [busy, setBusy] = useState(false);

  if (!visible) return null;

  async function handleInstall() {
    if (busy) return;
    setBusy(true);
    await promptInstall();
    setBusy(false);
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+6.25rem)] z-30 mx-auto flex max-w-[calc(100dvh*9/16)] px-3 md:max-w-none md:px-5">
      <div
        data-install-pill
        className="pointer-events-auto inline-flex items-center rounded-full bg-black/35 ring-1 ring-inset ring-white/15 backdrop-blur-[6px] motion-safe:animate-[fade-in_240ms_ease-out]"
      >
        <button
          type="button"
          onClick={() => void handleInstall()}
          aria-busy={busy}
          className={`${pillPart} gap-1.5 rounded-l-full pr-2.5 pl-2.5 text-[13px] font-semibold before:inset-x-0`}
        >
          <Download aria-hidden="true" className="h-4 w-4" />
          Uygulamayı yükle
        </button>
        <span aria-hidden="true" className="h-4 w-px bg-white/20" />
        <button
          type="button"
          onClick={() => dismissInstall()}
          aria-label="Şimdi değil"
          title="Şimdi değil"
          className={`${pillPart} w-8 justify-center rounded-r-full before:-inset-x-1`}
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
