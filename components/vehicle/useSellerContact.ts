"use client";

import { useEffect, useState } from "react";
import { getSellerWhatsAppUrl, type SellerContactVehicle } from "../../lib/feed";

// "WhatsApp'tan yaz": satıcının numarasını ister ve WhatsApp'ı açar.
// Akış kartı, detay çekmecesi ve ilan sayfası aynı davranışı paylaşır.
export function useSellerContact(vehicle: SellerContactVehicle) {
  const [isContacting, setIsContacting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Bilgi mesajı birkaç saniye sonra kalkar
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function contact() {
    if (isContacting) return;
    setIsContacting(true);

    try {
      const url = await getSellerWhatsAppUrl(vehicle);
      if (!url) {
        setNotice("Bu ilan için WhatsApp numarası bulunamadı.");
        return;
      }
      // Safari, beklemeden (await) sonra açılan yeni sekmeleri engelleyebilir;
      // o durumda WhatsApp aynı sekmede açılır
      const opened = window.open(url, "_blank");
      if (opened) opened.opener = null;
      else window.location.href = url;
    } catch (error) {
      console.error("Satıcı iletişim bilgisi alınamadı:", error);
      setNotice("Satıcının numarası alınamadı. İnternet bağlantını kontrol edip tekrar dene.");
    } finally {
      setIsContacting(false);
    }
  }

  return { contact, isContacting, notice };
}
