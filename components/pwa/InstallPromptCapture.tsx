"use client";

import { useEffect } from "react";
import { captureInstallPrompt } from "../../lib/install-prompt";

// Kök düzende: tarayıcının kurulum olayı (beforeinstallprompt) hangi sayfada
// gelirse gelsin yakalanır ve saklanır. Dinleyici modül yüklenirken bağlanır
// (hidrasyondan önce gelen olay kaçmaz); efekt yalnızca yedek. Hap mobil akışta
// (components/pwa/InstallAppButton.tsx).
export default function InstallPromptCapture() {
  useEffect(() => captureInstallPrompt(), []);
  return null;
}
