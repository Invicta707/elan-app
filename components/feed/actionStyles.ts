// Akış kartının sağ düğme sütunu (Beğen, Yorum, Paylaş, WhatsApp, Detaylar,
// Bildir, Ses) için ortak sınıflar.
//
// Mobil (< 1024 px, TikTok / Reels gibi): arka plansız 26 px beyaz simge, hafif
// gölgeyle videonun üstünde okunur; altında 11,5 px ince (500) sayaç/etiket.
// Sütun 44 px genişliğinde (uzun etiket, ör. "WhatsApp", iki yana taşar); her
// düğmenin dokunma alanı 44 px genişliğinde, simge ve etiketle ~58 px yüksekliğinde.
// (Masaüstünde akış yok: ana sayfa vitrin portalı; vitrindeki Shorts oynatıcısının
// sütunu aşağıdaki SHORTS_* sınıflarıyla.)

/** Düğmenin kendisi (simge + etiket, tek dokunma alanı) */
export const ACTION_BUTTON =
  "group pointer-events-auto flex w-11 flex-col items-center gap-0.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

/** Simgenin kutusu: saydam, 44×40 */
export const ACTION_ICON_BOX = "flex h-10 w-11 items-center justify-center rounded-full";

/** Simge: 26 px ve gölgeli (videonun üstünde okunur) */
export const ACTION_ICON = "h-[26px] w-[26px] drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]";

/** Simgenin altındaki sayaç / etiket */
export const ACTION_LABEL = "whitespace-nowrap text-[11.5px] font-medium leading-4 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]";

// Masaüstü Shorts oynatıcısı (components/portal/ShortsViewer.tsx): sütun
// videonun dışında, sağında, koyu sayfa zemininde (YouTube Shorts gibi).
// 48 px koyu daire, 22 px simge, altında 12 px etiket; dokunma alanı 56 px.

/** Düğmenin kendisi (daire + etiket, tek tıklama alanı) */
export const SHORTS_BUTTON =
  "group flex w-14 flex-col items-center gap-1 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

/** Simgenin dairesi */
export const SHORTS_ICON_BOX =
  "flex h-12 w-12 items-center justify-center rounded-full bg-[#27272A] text-white transition-colors group-hover:bg-[#3F3F46]";

/** Simge */
export const SHORTS_ICON = "h-[22px] w-[22px]";

/** Dairenin altındaki sayaç / etiket */
export const SHORTS_LABEL = "whitespace-nowrap text-[12px] font-medium leading-4 text-[#D4D4D8]";
