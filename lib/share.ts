// İlan paylaşımı: Web Share API varsa sistem paylaşım menüsü, yoksa bağlantıyı
// panoya kopyalama. Tarayıcı nesneleri parametre olarak alınır (testte taklit edilir).

export type ShareData = { url: string; title: string; text: string };

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

type ShareCapableNavigator = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

export function vehiclePath(vehicleId: string): string {
  return `/vehicles/${vehicleId}`;
}

export async function shareOrCopy(data: ShareData, nav: ShareCapableNavigator): Promise<ShareOutcome> {
  if (typeof nav.share === "function" && (nav.canShare?.(data) ?? true)) {
    try {
      await nav.share(data);
      return "shared";
    } catch (error) {
      // Kullanıcı menüyü kapattı: hata değil
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Diğer hatalarda (ör. izin verilmedi) panoya kopyalamayı dene
    }
  }

  if (nav.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(data.url);
      return "copied";
    } catch {
      return "failed";
    }
  }
  return "failed";
}
