import { permanentRedirect } from "next/navigation";

// Eski "Hesabım" sayfası Ayarlar'a taşındı. Adres korunur: yasal metinlerdeki
// eski bağlantılar ve Google Play'e verilen hesap silme adresi çalışmaya devam eder.
export default function AccountPage() {
  permanentRedirect("/settings");
}
