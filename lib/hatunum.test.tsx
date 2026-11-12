// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// /hatunum etkileşimi: daktilo → soru, HAYIR'ın klavye/fare/dokunuşla kaçması,
// EVET'in büyümesi, EVET sonrası terminal çıktısı. Sunucu tarafı
// lib/hatunum-switch.test.ts'te.

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import { HATUNUM_CONTENT, SIGNATURE } from "../app/hatunum/content";
import HatunumView from "../app/hatunum/HatunumView";

beforeEach(() => {
  vi.useFakeTimers();
  // Canvas yok: kutlama efekti sessizce atlanır
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function finishTyping() {
  fireEvent.click(screen.getByRole("button", { name: /atla/ }));
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

describe("HatunumView", () => {
  it("kod yazılırken soru ve düğmeler erişilemez; yazım bitince açılır", () => {
    const { container } = render(<HatunumView content={HATUNUM_CONTENT} />);
    const preview = container.querySelector("section")!;
    expect(preview.hasAttribute("inert")).toBe(true);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    finishTyping();
    expect(preview.hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Zülal, benimle sevgili olur musun?");
    expect(screen.getByAltText("Zülal").getAttribute("src")).toBe("/hatunum/foto");
    expect(container.textContent).toContain("en güzel bug'ım");
  });

  it("HAYIR klavye, tıklama ve dokunuşla kaçar; mesaj döner, EVET büyür", () => {
    render(<HatunumView content={HATUNUM_CONTENT} />);
    finishTyping();
    const no = screen.getByRole("button", { name: "HAYIR" });
    const yes = screen.getByRole("button", { name: "EVET" });

    fireEvent.keyDown(no, { key: "Enter" });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(no.hasAttribute("data-floating")).toBe(true);
    expect(no.style.transform).toMatch(/^translate3d\(/);
    expect(screen.getByText(/Yanlış butona basmaya çalışıyorsun/)).toBeTruthy();
    expect(yes.style.transform).toBe("scale(1.1)");

    fireEvent.click(no);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText(/404: Hayır bulunamadı/)).toBeTruthy();

    act(() => {
      no.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true }));
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText(/Bu butonun yetkisi yok/)).toBeTruthy();

    for (let i = 0; i < 20; i++) {
      fireEvent.click(no);
      act(() => {
        vi.advanceTimersByTime(200);
      });
    }
    expect(yes.style.transform).toBe("scale(1.8)");
    // HAYIR hiçbir zaman cevap üretmez
    expect(screen.queryByText(/relationship\.start\(\) \.\.\./)).toBeNull();
  });

  it("fare 120 px yakına gelince kaçar, uzaktayken kaçmaz", () => {
    render(<HatunumView content={HATUNUM_CONTENT} />);
    finishTyping();
    const no = screen.getByRole("button", { name: "HAYIR" });
    vi.spyOn(no, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 500, y: 400, width: 132, height: 52 }));

    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 100, clientY: 100, pointerType: "mouse" }));
    });
    expect(no.hasAttribute("data-floating")).toBe(false);

    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 450, clientY: 420, pointerType: "mouse" }));
    });
    expect(no.hasAttribute("data-floating")).toBe(true);
  });

  it("EVET'e basınca terminal çıktısı, imza ve tarih yazılır", () => {
    render(<HatunumView content={HATUNUM_CONTENT} />);
    finishTyping();
    fireEvent.click(screen.getByRole("button", { name: "EVET" }));
    for (let i = 0; i < 6; i++) {
      act(() => {
        vi.advanceTimersByTime(700);
      });
    }
    const output = screen.getByRole("status");
    expect(output.textContent).toContain("relationship.start() ... OK ✔");
    expect(output.textContent).toContain(`Sonsuza kadar return true; ❤️ — ${SIGNATURE}`);
    expect(output.textContent).toMatch(/\/\/ .*\d{4}.*\d{2}:\d{2}/);
    expect(screen.queryByRole("button", { name: "HAYIR" })).toBeNull();
  });
});
