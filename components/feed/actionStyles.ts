// Akış kartının sağ düğme sütunu (Favori, Yorum, Paylaş, WhatsApp, Detaylar,
// Bildir, Ses) için ortak sınıflar.
//
// Mobil (< 1024 px, TikTok / Reels gibi): arka plansız 26 px beyaz simge, hafif
// gölgeyle videonun üstünde okunur; altında 11,5 px ince (500) sayaç/etiket.
// Sütun 44 px genişliğinde (uzun etiket, ör. "WhatsApp", iki yana taşar); her
// düğmenin dokunma alanı 44 px genişliğinde, simge ve etiketle ~58 px yüksekliğinde.
// Masaüstü (lg): sütun videonun dışında, koyu zeminde; simgeler #27272A dairede.

/** Düğmenin kendisi (simge + etiket, tek dokunma alanı) */
export const ACTION_BUTTON =
  "group pointer-events-auto flex w-11 flex-col items-center gap-0.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white lg:gap-1";

/** Simgenin kutusu: mobilde saydam, masaüstünde daire */
export const ACTION_ICON_BOX =
  "flex h-10 w-11 items-center justify-center rounded-full lg:h-11 lg:bg-[#27272A] lg:group-hover:bg-[#3F3F46]";

/** Simge: mobilde 26 px ve gölgeli, masaüstünde 20 px */
export const ACTION_ICON = "h-[26px] w-[26px] drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] lg:h-5 lg:w-5 lg:drop-shadow-none";

/** Simgenin altındaki sayaç / etiket */
export const ACTION_LABEL = "whitespace-nowrap text-[11.5px] font-medium leading-4 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]";
