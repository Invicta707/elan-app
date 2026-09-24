import { Barlow, Barlow_Condensed } from "next/font/google";

// Yazı tipleri tek yerde tanımlanır; hem akış hem arama sayfası buradan içe aktarır.
// Fiyat ve model adı için dar (condensed) bir yazı tipi: plaka karakterlerine yakın,
// uzun rakamları dar alanda okunaklı tutar. Gövde metni aynı ailenin normal genişliği.
// latin-ext, Türkçe karakterler (ş, ğ, İ, ı) için gerekli.
export const displayFont = Barlow_Condensed({
  subsets: ["latin", "latin-ext"],
  weight: ["600", "800"],
  variable: "--font-display",
});

export const bodyFont = Barlow({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});