"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { HatunumContent, Token } from "./content";
import styles from "./hatunum.module.css";

// /hatunum görünümü. Kod editörü teması, daktiloyla
// yazılan kod, fotoğraf, kaçan HAYIR, EVET'te canvas kalp/konfeti yağmuru.
// Kütüphane yok; aç/kapa denetimi page.tsx'te. Kişisel metnin tamamı
// content.ts'ten (yalnızca sunucu) prop olarak gelir; bu dosyada isim yok.

type Prepared = { code: Token[][]; lineTexts: string[]; lineStarts: number[]; source: string; total: number };

/** Kodun düz metni ve satır başlangıçları (daktilo ve imleç için) */
function prepare(code: Token[][]): Prepared {
  const lineTexts = code.map((line) => line.map(([, text]) => text).join(""));
  const lineStarts = lineTexts.map((_, index) => lineTexts.slice(0, index).reduce((sum, text) => sum + text.length + 1, 0));
  const source = lineTexts.join("\n");
  return { code, lineTexts, lineStarts, source, total: source.length };
}

/** İmlecin HAYIR'a bu kadar yaklaşması yeter (px) */
const DODGE_RADIUS = 120;
const YES_MAX_SCALE = 1.8;

type Phase = "typing" | "reveal" | "yes";
type Point = { x: number; y: number };

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** İmlecin satır/sütunu (durum çubuğu için) */
function cursorLineCol(source: string, typed: number) {
  const before = source.slice(0, typed).split("\n");
  return { line: before.length, col: before[before.length - 1].length + 1 };
}

function CodeLines({ prepared, typed }: { prepared: Prepared; typed: number }) {
  const { line: activeLine } = cursorLineCol(prepared.source, typed);
  return (
    <>
      {prepared.code.map((tokens, index) => {
        const start = prepared.lineStarts[index];
        const length = prepared.lineTexts[index].length;
        const cursorAt = index + 1 === activeLine ? typed - start : -1;
        let offset = 0;
        const parts = tokens.map(([kind, text], j) => {
          const tokenStart = offset;
          offset += text.length;
          const shown = Math.min(Math.max(typed - start - tokenStart, 0), text.length);
          const caretInside = cursorAt >= tokenStart && cursorAt < tokenStart + text.length;
          return (
            <span key={j} className={styles[kind]}>
              {text.slice(0, shown)}
              {caretInside && <span className={styles.caret} />}
              {shown < text.length && <span className={styles.ghost}>{text.slice(shown)}</span>}
            </span>
          );
        });
        return (
          <div key={index} className={`${styles.line} ${index + 1 === activeLine ? styles.activeLine : ""}`}>
            <span className={styles.lineNo}>{index + 1}</span>
            <code className={styles.lineCode}>
              {parts}
              {cursorAt === length && <span className={styles.caret} />}
              {"​"}
            </code>
          </div>
        );
      })}
    </>
  );
}

function formatNow(date: Date) {
  return date.toLocaleString("tr-TR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  });
}

export default function HatunumView({ content }: { content: HatunumContent }) {
  const [prepared] = useState(() => prepare(content.code));
  const { source: SOURCE, total: TOTAL } = prepared;
  const [phase, setPhase] = useState<Phase>("typing");
  const [typed, setTyped] = useState(0);
  const [dodges, setDodges] = useState(0);
  const [noPos, setNoPos] = useState<(Point & { animate: boolean }) | null>(null);
  const [yesAt, setYesAt] = useState<Date | null>(null);
  const [outputStep, setOutputStep] = useState(0);

  const noRef = useRef<HTMLButtonElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<Point | null>(null);
  const lastDodgeRef = useRef(0);

  // Daktilo: her karakter ayrı zamanlayıcı (requestAnimationFrame değil: arka
  // plandaki sekmede de ilerler). Hareket azaltma tercihinde kod hemen görünür.
  useEffect(() => {
    if (phase !== "typing") return;
    if (typed === 0 && prefersReducedMotion()) {
      const timer = window.setTimeout(() => setTyped(TOTAL), 0);
      return () => window.clearTimeout(timer);
    }
    if (typed >= TOTAL) {
      const timer = window.setTimeout(() => setPhase("reveal"), 380);
      return () => window.clearTimeout(timer);
    }
    const delay = SOURCE[typed] === "\n" ? 150 : 14 + Math.random() * 14;
    const timer = window.setTimeout(() => setTyped((count) => count + 1), delay);
    return () => window.clearTimeout(timer);
  }, [phase, typed, SOURCE, TOTAL]);

  const dodge = useCallback((from: Point) => {
    const button = noRef.current;
    if (!button) return;
    const now = performance.now();
    if (now - lastDodgeRef.current < 90) return;
    lastDodgeRef.current = now;

    const rect = button.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const margin = 12;
    const maxX = Math.max(margin, document.documentElement.clientWidth - width - margin);
    const maxY = Math.max(margin, window.innerHeight - height - margin);
    const yes = yesRef.current?.getBoundingClientRect();

    // Rastgele adaylar: imleçten 200 px'ten uzak, ama ekranın öbür ucuna da
    // ışınlanmasın (akıcı görünsün); EVET'in üstüne binmesin.
    let best: Point | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 48; i++) {
      const x = margin + Math.random() * (maxX - margin);
      const y = margin + Math.random() * (maxY - margin);
      if (yes && x < yes.right + 16 && x + width > yes.left - 16 && y < yes.bottom + 16 && y + height > yes.top - 16) {
        continue;
      }
      const distance = Math.hypot(x + width / 2 - from.x, y + height / 2 - from.y);
      const score = distance < 200 ? distance / 1000 : distance > 560 ? 1 - (distance - 560) / 2000 : 1 + Math.random() * 0.2;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    const target = best ?? { x: from.x > maxX / 2 ? margin : maxX, y: from.y > maxY / 2 ? margin : maxY };

    if (!posRef.current) {
      // İlk kaçış: düğme yerinden "kopar" (sabit konuma geçer), sonra kayar
      posRef.current = { x: rect.left, y: rect.top };
      setNoPos({ x: rect.left, y: rect.top, animate: false });
      window.setTimeout(() => {
        posRef.current = target;
        setNoPos({ ...target, animate: true });
      }, 20);
    } else {
      posRef.current = target;
      setNoPos({ ...target, animate: true });
    }
    setDodges((count) => count + 1);
  }, []);

  // Fare (ya da kalem) HAYIR'ın 120 px yakınına girince kaçar
  useEffect(() => {
    if (phase !== "reveal") return;
    function onMove(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      const button = noRef.current;
      if (!button) return;
      const rect = posRef.current
        ? {
            left: posRef.current.x,
            top: posRef.current.y,
            right: posRef.current.x + button.offsetWidth,
            bottom: posRef.current.y + button.offsetHeight,
          }
        : button.getBoundingClientRect();
      const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
      const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
      if (Math.hypot(dx, dy) < DODGE_RADIUS) dodge({ x: event.clientX, y: event.clientY });
    }
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [phase, dodge]);

  // Dokunmatik: parmak değdiği an kaçar (tıklama hiç oluşmaz)
  useEffect(() => {
    const button = noRef.current;
    if (!button || phase !== "reveal") return;
    function onTouch(event: TouchEvent) {
      event.preventDefault();
      const touch = event.touches ? event.touches[0] : undefined;
      dodge(touch ? { x: touch.clientX, y: touch.clientY } : centerOf(button!));
    }
    button.addEventListener("touchstart", onTouch, { passive: false });
    return () => button.removeEventListener("touchstart", onTouch);
  }, [phase, dodge]);

  // Pencere boyutu değişirse kaçmış düğme ekranda kalsın
  useEffect(() => {
    function onResize() {
      const button = noRef.current;
      if (!posRef.current || !button) return;
      const x = Math.min(posRef.current.x, Math.max(12, document.documentElement.clientWidth - button.offsetWidth - 12));
      const y = Math.min(posRef.current.y, Math.max(12, window.innerHeight - button.offsetHeight - 12));
      posRef.current = { x, y };
      setNoPos({ x, y, animate: false });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // EVET sonrası terminal çıktısı satır satır gelir
  useEffect(() => {
    if (phase !== "yes" || outputStep >= 4) return;
    const timer = window.setTimeout(() => setOutputStep((step) => step + 1), outputStep === 0 ? 250 : 650);
    return () => window.clearTimeout(timer);
  }, [phase, outputStep]);

  useEffect(() => {
    if (phase === "yes") outputRef.current?.scrollIntoView({ block: "nearest" });
  }, [phase, outputStep]);

  function onNoKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      dodge(centerOf(event.currentTarget));
    }
  }

  function sayYes() {
    setYesAt(new Date());
    setPhase("yes");
  }

  const revealed = phase !== "typing";
  const yesScale = Math.min(1 + dodges * 0.1, YES_MAX_SCALE);
  const { line, col } = cursorLineCol(SOURCE, typed);
  const warnings = [];
  for (let n = Math.max(1, dodges - 1); n <= dodges; n++) warnings.push(n);

  return (
    <div className={styles.page}>
      <div className={styles.glowA} aria-hidden="true" />
      <div className={styles.glowB} aria-hidden="true" />

      <main className={styles.window}>
        <div className={styles.titleBar}>
          <span className={styles.dots} aria-hidden="true">
            <i className={styles.dotRed} />
            <i className={styles.dotYellow} />
            <i className={styles.dotGreen} />
          </span>
          <span className={styles.tab}>
            <span className={styles.jsIcon} aria-hidden="true">JS</span>
            {content.fileName}
            <span className={styles.tabClose} aria-hidden="true">×</span>
          </span>
          <span className={`${styles.tab} ${styles.tabInactive}`} aria-hidden="true">
            kalp.css
          </span>
          {phase === "typing" && (
            <button type="button" className={styles.skip} onClick={() => setTyped(TOTAL)}>
              atla ⏭
            </button>
          )}
        </div>

        <div className={styles.editor} aria-label={content.fileName} role="region">
          <CodeLines prepared={prepared} typed={typed} />
        </div>

        <section className={styles.preview} data-revealed={revealed} inert={!revealed}>
          <div className={styles.photoRing}>
            <Image
              src={content.photoSrc}
              alt={content.photoAlt}
              width={720}
              height={720}
              unoptimized
              priority
              className={styles.photo}
            />
          </div>

          <div className={styles.ask}>
            <p className={styles.prompt}>
              <span className={styles.promptSign}>❯</span> {content.prompt}
            </p>
            <h1 className={styles.question}>
              <span className={styles.name}>{content.name}</span>
              {content.question}
            </h1>

            {phase !== "yes" ? (
              <>
                <div className={styles.buttons}>
                  <button
                    ref={yesRef}
                    type="button"
                    className={styles.yes}
                    style={{ transform: `scale(${yesScale})` }}
                    onClick={sayYes}
                  >
                    EVET
                  </button>
                  <span className={styles.noSlot}>
                    <button
                      ref={noRef}
                      type="button"
                      className={styles.no}
                      data-floating={noPos ? "true" : undefined}
                      style={
                        noPos
                          ? {
                              transform: `translate3d(${noPos.x}px, ${noPos.y}px, 0)`,
                              transition: noPos.animate ? undefined : "none",
                            }
                          : undefined
                      }
                      onMouseEnter={(event) => dodge({ x: event.clientX, y: event.clientY })}
                      onKeyDown={onNoKeyDown}
                      onClick={(event) => dodge(centerOf(event.currentTarget))}
                    >
                      HAYIR
                    </button>
                  </span>
                </div>
                <div className={styles.warnings} aria-live="polite">
                  {warnings.map((n) => (
                    <p key={n} className={styles.warning}>
                      <span className={styles.warnTag}>warn</span> {content.noMessages[(n - 1) % content.noMessages.length]}
                    </p>
                  ))}
                </div>
              </>
            ) : (
              <div ref={outputRef} className={styles.terminal} role="status">
                {outputStep >= 1 && (
                  <p>
                    <span className={styles.promptSign}>&gt;</span> {content.output.command}{" "}
                    <span className={styles.ok}>OK ✔</span>
                  </p>
                )}
                {outputStep >= 2 && (
                  <p className={styles.dim}>
                    <span className={styles.promptSign}>&gt;</span> {content.output.status}
                  </p>
                )}
                {outputStep >= 3 && (
                  <p className={styles.signature}>{content.output.signature}</p>
                )}
                {outputStep >= 4 && yesAt && <p className={styles.cmt}>{"// "}{formatNow(yesAt)}</p>}
                <span className={styles.caret} />
              </div>
            )}
          </div>
        </section>

        <footer className={styles.statusBar} aria-hidden="true">
          <span>⎇ main</span>
          <span>{phase === "yes" ? content.statusDone : "✔ 0 hata"}</span>
          <span className={styles.statusRight}>
            Ln {line}, Col {col}
          </span>
          <span>UTF-8</span>
          <span>JavaScript</span>
          <span>💜</span>
        </footer>
      </main>

      {phase === "yes" && <Celebration />}
    </div>
  );
}

function centerOf(element: HTMLElement): Point {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// ---------------------------------------------------------------------------
// Kalp + konfeti yağmuru (canvas, kütüphanesiz)

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  rotation: number;
  spin: number;
  size: number;
  color: string;
  heart: boolean;
  flip: number;
};

const COLORS = ["#7ee787", "#bc8cff", "#ff7b9c", "#ffd166", "#79c0ff", "#ff4d6d"];
const RAIN_MS = 5000;

function Celebration() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ctx = context;
    const reduce = prefersReducedMotion();
    let width = 0;
    let height = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    const particles: Particle[] = [];
    const pick = () => COLORS[Math.floor(Math.random() * COLORS.length)];

    // Ortadan patlama
    for (let i = 0; i < (reduce ? 40 : 170); i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 10;
      particles.push({
        x: width / 2,
        y: height * 0.42,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 4,
        gravity: 0.22,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        size: 7 + Math.random() * 9,
        color: pick(),
        heart: Math.random() < 0.45,
        flip: Math.random() * Math.PI,
      });
    }

    function rain() {
      particles.push({
        x: Math.random() * width,
        y: -24,
        vx: (Math.random() - 0.5) * 1.2,
        vy: 1.2 + Math.random() * 2.2,
        gravity: 0.015,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.08,
        size: 10 + Math.random() * 14,
        color: Math.random() < 0.6 ? "#ff4d6d" : pick(),
        heart: Math.random() < 0.75,
        flip: Math.random() * Math.PI,
      });
    }

    function drawHeart(p: Particle) {
      const s = p.size / 16;
      ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.bezierCurveTo(-11, -2, -7, -12, 0, -5);
      ctx.bezierCurveTo(7, -12, 11, -2, 0, 6);
      ctx.fill();
    }

    const startedAt = performance.now();
    let last = startedAt;
    let frame = 0;

    function tick(now: number) {
      const dt = Math.min((now - last) / 16.67, 3);
      last = now;
      if (now - startedAt < RAIN_MS) {
        for (let i = 0; i < (reduce ? 1 : 3); i++) rain();
      }
      ctx.clearRect(0, 0, width, height);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vy += p.gravity * dt;
        p.vx *= 0.99;
        p.x += (p.vx + Math.sin(p.flip) * 0.4) * dt;
        p.y += p.vy * dt;
        p.rotation += p.spin * dt;
        p.flip += 0.08 * dt;
        if (p.y > height + 40 || p.x < -60 || p.x > width + 60) {
          particles.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        if (p.heart) {
          drawHeart(p);
        } else {
          ctx.scale(1, Math.cos(p.flip));
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }
        ctx.restore();
      }
      if (particles.length > 0 || now - startedAt < RAIN_MS) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />;
}
