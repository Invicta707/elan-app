// Dikey akışta klavyeyle ilan ilan gezinme (klavyeli tablet, dar pencere) ve
// masaüstü düzeninin eşiği. UI'dan bağımsız: testleri lib/feed-navigation.test.ts'te.

/**
 * Masaüstü düzeni: 1024 px ve üstü; ana sayfa ilan arama ve vitrin portalıdır
 * (components/portal). Altında mobil akış (tam ekran dikey video, sağ sütun,
 * alttan açılan yorum penceresi). Tailwind'in lg: eşiğiyle aynı.
 */
export const DESKTOP_MEDIA_QUERY = "(min-width: 64rem)";

/** ↓ / PageDown sonraki, ↑ / PageUp önceki ilan; diğer tuşlar 0 */
export function feedKeyStep(key: string): -1 | 0 | 1 {
  if (key === "ArrowDown" || key === "PageDown") return 1;
  if (key === "ArrowUp" || key === "PageUp") return -1;
  return 0;
}

/** Yazı yazılan alan: tuşlar ona aittir (yorum kutusu, arama alanı) */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  return Boolean(element.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}

type FeedKeyEvent = Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "defaultPrevented" | "target">;

/**
 * Tuş akışta gezinmek için mi? Değiştirici tuşla basılmışsa, yazı alanındaysa
 * ya da açık bir pencere varsa hayır: 0.
 */
export function feedKeyStepFor(event: FeedKeyEvent, dialogOpen: boolean): -1 | 0 | 1 {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || dialogOpen) return 0;
  if (isEditableTarget(event.target)) return 0;
  return feedKeyStep(event.key);
}

/** Sıradaki kart: listenin sınırında durur */
export function clampFeedIndex(index: number, lastIndex: number): number {
  if (lastIndex < 0) return 0;
  return Math.min(Math.max(0, index), lastIndex);
}
