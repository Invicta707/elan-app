// İlan paylaşımı. Telefonda sistemin paylaşım menüsü (Web Share API);
// desteklenmiyorsa ya da masaüstündeyse bağlantı panoya kopyalanır ve WhatsApp
// açılır. Tarayıcı nesneleri parametre olarak alınır (testte taklit edilir).

export type ShareData = { url: string; title: string; text: string };

type ShareCapableNavigator = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

export type ShareEnvironment = {
  nav: ShareCapableNavigator;
  /** Fare/touchpad ile kullanılan cihaz: sistem menüsü yerine kopyala + WhatsApp */
  isDesktop: boolean;
  /** Yeni sekmede açar; açılır pencere engellendiyse false */
  openWindow: (url: string) => boolean;
};

export type ShareOutcome =
  | { kind: "shared" }
  | { kind: "cancelled" }
  | { kind: "fallback"; copied: boolean; whatsappOpened: boolean; whatsappUrl: string };

export function vehiclePath(vehicleId: string): string {
  return `/vehicles/${vehicleId}`;
}

/** WhatsApp paylaşım bağlantısı: telefonda uygulamayı, masaüstünde WhatsApp Web/Desktop'ı açar */
export function whatsappShareUrl(data: Pick<ShareData, "text" | "url">): string {
  return `https://wa.me/?text=${encodeURIComponent(`${data.text} ${data.url}`)}`;
}

export async function shareListing(data: ShareData, env: ShareEnvironment): Promise<ShareOutcome> {
  const { nav } = env;
  if (!env.isDesktop && typeof nav.share === "function" && (nav.canShare?.(data) ?? true)) {
    try {
      await nav.share(data);
      return { kind: "shared" };
    } catch (error) {
      // Kullanıcı menüyü kapattı: hata değil, başka bir şey açılmaz
      if (error instanceof DOMException && error.name === "AbortError") return { kind: "cancelled" };
      // Diğer hatalarda (ör. izin verilmedi) kopyala + WhatsApp'a düş
    }
  }

  let copied = false;
  if (nav.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(data.url);
      copied = true;
    } catch {
      // Pano izni yok: WhatsApp bağlantısı yine de sunulur
    }
  }

  const whatsappUrl = whatsappShareUrl(data);
  return { kind: "fallback", copied, whatsappOpened: env.openWindow(whatsappUrl), whatsappUrl };
}

/** Sonuca göre kullanıcıya gösterilecek kısa mesaj; null: mesaj gerekmez */
export function shareMessage(outcome: ShareOutcome): { text: string; showWhatsappLink: boolean } | null {
  if (outcome.kind !== "fallback") return null;
  if (outcome.copied && outcome.whatsappOpened) {
    return { text: "Bağlantı kopyalandı, WhatsApp açılıyor.", showWhatsappLink: false };
  }
  if (outcome.copied) return { text: "Bağlantı kopyalandı.", showWhatsappLink: true };
  if (outcome.whatsappOpened) return { text: "WhatsApp açılıyor.", showWhatsappLink: false };
  return { text: "Bağlantı kopyalanamadı.", showWhatsappLink: true };
}
