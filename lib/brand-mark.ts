// gözüyle işareti: badem biçimli ince bir göz hattı ve göz bebeğinin yerinde
// oynat üçgeni (araç gözlemleme + video). Tek renk, 100 birimlik tuvalde.
// Aynı çizim üst çubuktaki logoda, videodaki duraklatma simgesinde ve uygulama
// ikonlarında (scripts/generate-icons.mjs bu dosyayı içe aktarır) kullanılır.
//
// Bu dosya yalnızca sabit içerir: Node betiği TypeScript'i tip silmeyle
// doğrudan çalıştırabilsin.

/** Göz hattı: üst ve alt kapak, köşeleri sivri ama yumuşak (kübik eğriler) */
export const EYE_PATH = "M 7 50 C 21 26.5, 36 20, 50 20 C 64 20, 79 26.5, 93 50 C 79 73.5, 64 80, 50 80 C 36 80, 21 73.5, 7 50 Z";

/** Oynat üçgeni: ağırlık merkezi göz merkezinde (50, 50) */
export const PLAY_POINTS = "43.5,39.5 43.5,60.5 61.5,50";

/** Çizgi kalınlığı (100 birimde): 36 px'te ≈1,6 px, ince ama okunaklı */
export const EYE_STROKE = 4.5;

/** Üçgenin köşelerini yumuşatan ince kontur */
export const PLAY_ROUNDING = 3;
