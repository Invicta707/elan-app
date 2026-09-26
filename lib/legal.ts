// Yasal sayfaların (/privacy, /terms) ve hesap sayfasının ortak bilgileri.

const DEFAULT_SUPPORT_EMAIL = "destek@gozuyle.com";

/** Boş ya da e-postaya benzemeyen değer varsayılana düşer (build asla düşmez) */
export function resolveSupportEmail(value: string | undefined): string {
  const email = value?.trim();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : DEFAULT_SUPPORT_EMAIL;
}

// Google Play gizlilik politikasında çalışan bir iletişim adresi ister; KVKK
// başvuruları ve hesap silme talepleri de buraya gelir. Adres değişirse kod
// değil ortam değişkeni güncellenir (NEXT_PUBLIC_: build sırasında gömülür,
// değiştirince yeniden deploy gerekir).
export const LEGAL_CONTACT_EMAIL = resolveSupportEmail(process.env.NEXT_PUBLIC_SUPPORT_EMAIL);

/** Metinlerde değişiklik yapılınca güncellenir */
export const LEGAL_LAST_UPDATED = "26 Eylül 2026";
