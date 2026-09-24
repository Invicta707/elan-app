// Türkiye telefon numaralarını WhatsApp'ın (wa.me) beklediği, başında + olmadan
// uluslararası formata (90XXXXXXXXXX) çevirir. UI'dan bağımsız: hem yazma
// tarafında (app/sell/page.tsx — profile kaydedilirken) hem okuma tarafında
// (lib/feed.ts — RPC'den dönen değer normalize edilirken) kullanılır, böylece
// veritabanına her zaman tek, öngörülebilir bir formatta yazılır.
//
// Kurallar:
//   5XX XXX XX XX  (10 hane, "5" ile başlıyor)      -> 90 + numara
//   05XX XXX XX XX (11 hane, "0" ile başlıyor)       -> baştaki 0 silinir, 90 eklenir
//   905XX XXX XX XX / 00905XX... (zaten 90 ile başlıyor) -> olduğu gibi (90XXXXXXXXXX)
// Hiçbiriyle eşleşmeyen bir girdi geçersiz sayılır (null).
export function normalizeTurkishPhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");

  if (digits.startsWith("00")) {
    digits = digits.slice(2); // 0090532... → 90532...
  }

  if (digits.startsWith("90") && digits.length === 12) {
    return digits;
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return `90${digits.slice(1)}`;
  }
  if (digits.length === 10 && digits.startsWith("5")) {
    return `90${digits}`;
  }

  return null;
}
