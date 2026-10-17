"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "./cansu.module.css";

// Sürpriz sayfası (iPhone 11 / iOS Safari, 414×896 CSS px hedefli). Alt gezinme ve
// kullanıcı adı penceresi bu rotada gizli (lib/navigation.ts, UsernameOnboarding).

const WA_WILD_RIFT =
  "https://wa.me/905445673430?text=A%C5%9Fk%C4%B1m%20hemen%20Wild%20Rift'e%20giriyoruz,%20beni%20ta%C5%9F%C4%B1man%20laz%C4%B1m!%20%E2%9A%94%EF%B8%8F%F0%9F%92%96";
const WA_VOICE =
  "https://wa.me/905445673430?text=Hemen%20sesini%20duymak%20istiyorum,%20m%C3%BCsait%20olunca%20ara%20beni!%20%E2%98%8E%EF%B8%8F%E2%9D%A4%EF%B8%8F";
const WA_FOOTER =
  "https://wa.me/905445673430?text=Siteni%20g%C3%B6rd%C3%BCm,%20inan%C4%B1lmaz%20g%C3%BCzel%20olmu%C5%9F!%20%E2%9D%A4%EF%B8%8F";

const CALC_MS = 1500;
const RAIN_MS = 6000;
const HEART_GLYPHS = ["💖", "❤️", "💕", "💗", "💘", "🌹"];

type Phase = "idle" | "calculating" | "done";
type Heart = { id: number; glyph: string; style: CSSProperties };

/** Kalp yağmuru: rastgele konum/gecikme/süre (render dışında, tıklamada üretilir) */
function makeHearts(count: number, seed: number): Heart[] {
  return Array.from({ length: count }, (_, i) => ({
    id: seed * 1000 + i,
    glyph: HEART_GLYPHS[i % HEART_GLYPHS.length],
    style: {
      "--x": `${Math.random() * 100}%`,
      "--size": `${18 + Math.random() * 22}px`,
      "--delay": `${Math.random() * 1.6}s`,
      "--duration": `${2.6 + Math.random() * 2.2}s`,
      "--drift": `${Math.round((Math.random() - 0.5) * 120)}px`,
      "--spin": `${Math.round((Math.random() - 0.5) * 540)}deg`,
    } as CSSProperties,
  }));
}

const tap = "touch-manipulation [-webkit-tap-highlight-color:transparent] transition-transform active:scale-95";

export default function CansuKamilPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [percent, setPercent] = useState(0);
  const [hearts, setHearts] = useState<Heart[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const runs = useRef(0);
  const eveningCard = useRef<HTMLElement>(null);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      if (ticker.current) clearInterval(ticker.current);
    },
    [],
  );

  // Akşam kartı açılınca görünür alana kaydır (alt kısmı sabit WhatsApp butonunun altında kalmasın)
  useEffect(() => {
    if (phase !== "done") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const id = setTimeout(() => eveningCard.current?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "end" }), 350);
    return () => clearTimeout(id);
  }, [phase]);

  function measure() {
    if (phase === "calculating") return;
    setPhase("calculating");
    setPercent(0);
    setHearts([]);

    const startedAt = Date.now();
    ticker.current = setInterval(() => {
      setPercent(Math.min(99, Math.round(((Date.now() - startedAt) / CALC_MS) * 99)));
    }, 50);

    timers.current.push(
      setTimeout(() => {
        if (ticker.current) clearInterval(ticker.current);
        ticker.current = null;
        setPercent(99);
        setPhase("done");
        runs.current += 1;
        setHearts(makeHearts(42, runs.current));
        timers.current.push(setTimeout(() => setHearts([]), RAIN_MS));
      }, CALC_MS),
    );
  }

  return (
    <div className="min-h-[100dvh] w-full bg-[radial-gradient(ellipse_at_top,#4a0d2a_0%,#1c0612_55%,#0d0308_100%)] font-sans text-white">
      <main className="mx-auto flex w-full max-w-[414px] flex-col items-center overflow-x-hidden px-5 pt-[calc(env(safe-area-inset-top)+2.5rem)] pb-[calc(env(safe-area-inset-bottom)+7.5rem)] text-center">
        <div className={`relative size-56 shrink-0 overflow-hidden rounded-full ${styles.glow}`}>
          <Image
            src="/images/cansu.jpg"
            alt="Cansu"
            width={600}
            height={600}
            priority
            sizes="224px"
            className="size-full rounded-full object-cover"
          />
        </div>

        <h1 className="mt-8 text-[2rem] leading-tight font-extrabold tracking-tight text-balance">
          Güzeller güzeli Cansu
        </h1>
        <p className="mt-3 rounded-full border border-pink-300/30 bg-pink-500/15 px-4 py-1.5 text-sm font-semibold text-pink-100">
          💖 1/1 · Paha Biçilemez · Ömürlük 💖
        </p>

        <section className="mt-10 w-full rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
          <button
            type="button"
            onClick={measure}
            disabled={phase === "calculating"}
            className={`${tap} min-h-14 w-full rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-6 text-lg font-bold shadow-lg shadow-pink-500/30 disabled:opacity-80 ${
              phase === "calculating" ? "" : styles.pulse
            }`}
          >
            Aşkımızı Ölç ❤️
          </button>

          <div aria-live="polite" className="mt-4 min-h-14">
            {phase === "calculating" && (
              <p className="text-base font-semibold text-pink-200">
                <span
                  aria-hidden
                  className="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-pink-200 border-t-transparent align-[-2px]"
                />
                Hesaplanıyor... %{percent}...
              </p>
            )}
            {phase === "done" && (
              <p className={`rounded-2xl bg-gradient-to-r from-rose-500/25 to-pink-500/25 px-4 py-3 text-lg font-extrabold ${styles.fadeUp}`}>
                Aşk Oranı: %1000000 (Sonsuz Sevgi) 🔥
              </p>
            )}
          </div>
        </section>

        {phase === "done" && (
          <section
            ref={eveningCard}
            className={`mt-6 w-full scroll-mb-[calc(env(safe-area-inset-bottom)+6.5rem)] rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm ${styles.fadeUp}`}
            style={{ animationDelay: "0.25s" }}
          >
            <h2 className="text-lg leading-snug font-bold text-balance">
              Madem aşkımız tescillendi... Bu akşam ne yapıyoruz? 🥰
            </h2>
            <div className="mt-5 flex flex-col gap-3">
              <a
                href={WA_WILD_RIFT}
                className={`${tap} flex min-h-14 items-center justify-center rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 text-base font-bold`}
              >
                🎮 Wild Rift Oynayalım!
              </a>
              <a
                href={WA_VOICE}
                className={`${tap} flex min-h-14 items-center justify-center rounded-2xl bg-gradient-to-r from-fuchsia-500 to-pink-500 px-5 text-base font-bold`}
              >
                🎧 Sesli Konuşalım!
              </a>
            </div>
          </section>
        )}
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-[#0d0308] via-[#0d0308]/90 to-transparent pt-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        <div className="mx-auto w-full max-w-[414px] px-5">
          <a
            href={WA_FOOTER}
            className={`${tap} flex min-h-14 w-full items-center justify-center rounded-full bg-[#25D366] px-6 text-lg font-bold text-white shadow-lg shadow-green-500/30`}
          >
            Bana WhatsApp&apos;tan yaz balım ❤️
          </a>
        </div>
      </footer>

      {hearts.length > 0 && (
        <div aria-hidden className={styles.rain} data-testid="heart-rain">
          {hearts.map((heart) => (
            <span key={heart.id} className={styles.heart} style={heart.style}>
              {heart.glyph}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
