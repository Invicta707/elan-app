// /hatunum'un bütün kişisel metni. Yalnızca page.tsx (sunucu bileşeni) içe aktarır;
// istemci bileşeninden içe AKTARMA. Sayfa AÇIKKEN
// HatunumView'e prop olarak gider. İstemci paketine (herkese açık
// /_next/static/chunks/…) girmez: kapalıyken 404 yanıtı o paketi listelese bile
// isim ve mesajlar sızmaz.

/** Son mesajdaki imza: yalnızca burayı değiştir */
export const SIGNATURE = "Kamil";

export type TokenClass = "kw" | "kw2" | "cls" | "fn" | "var" | "prop" | "str" | "cmt" | "p";
export type Token = [TokenClass, string];

export type HatunumContent = {
  fileName: string;
  code: Token[][];
  prompt: string;
  name: string;
  question: string;
  photoAlt: string;
  /** Fotoğraf adresi: aç/kapa denetimli route (app/hatunum/foto/route.ts) */
  photoSrc: string;
  noMessages: string[];
  output: { command: string; status: string; signature: string };
  statusDone: string;
};

export const HATUNUM_CONTENT: HatunumContent = {
  fileName: "zulal.js",
  code: [
    [["cmt", "// zulal.js: 0 hata, 0 uyarı, 1 kalp"]],
    [
      ["kw2", "const "], ["var", "zulal"], ["p", " = "], ["kw2", "new "], ["cls", "Person"], ["p", "({ "],
      ["prop", "name"], ["p", ": "], ["str", '"Zülal"'], ["p", ", "], ["prop", "status"], ["p", ": "],
      ["str", "\"en güzel bug'ım\""], ["p", " });"],
    ],
    [
      ["kw2", "const "], ["var", "me"], ["p", " = "], ["kw2", "new "], ["cls", "Developer"], ["p", "({ "],
      ["prop", "heart"], ["p", ": "], ["str", '"sadece sende"'], ["p", " });"],
    ],
    [],
    [
      ["kw", "while "], ["p", "("], ["var", "me"], ["p", "."], ["fn", "isAwake"], ["p", "()) "], ["var", "me"],
      ["p", "."], ["fn", "think"], ["p", "("], ["var", "zulal"], ["p", ");"], ["cmt", " // bilerek sonsuz döngü"],
    ],
    [
      ["kw", "if "], ["p", "("], ["var", "zulal"], ["p", "."], ["fn", "loves"], ["p", "("], ["var", "me"], ["p", ")) { "],
      ["var", "relationship"], ["p", "."], ["fn", "start"], ["p", "(); }"],
    ],
    [["kw", "else "], ["p", "{ "], ["cmt", "/* hata: bu ihtimal yok */"], ["p", " }"]],
    [["kw", "await "], ["var", "zulal"], ["p", "."], ["fn", "answer"], ["p", "();"], ["cmt", " // cevabın aşağıda ↓"]],
  ],
  prompt: "zulal.answer()",
  name: "Zülal",
  question: ", benimle sevgili olur musun?",
  photoAlt: "Zülal",
  photoSrc: "/hatunum/foto",
  noMessages: [
    "Yanlış butona basmaya çalışıyorsun 😏",
    "404: Hayır bulunamadı",
    "Bu butonun yetkisi yok 🔒",
    "Segmentation fault: kalp bu cevabı kaldıramaz",
    "git push --force hayir → reddedildi ❌",
    "Hayır deprecated oldu, lütfen EVET kullan",
    "StackOverflowError: seni sevmekten 💜",
    "Bu buton production'da devre dışı 🙃",
  ],
  output: {
    command: "relationship.start() ...",
    status: 'status: "sevgili", uptime: ∞',
    signature: `Sonsuza kadar return true; ❤️ — ${SIGNATURE}`,
  },
  statusDone: "✔ 1 kalp birleştirildi",
};
