// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getCommentCount, resetCommentCounts, setCommentCount, useCommentCount } from "./use-comment-counts";

// Yorum sayısı deposu: akış kartı, yorum penceresi ve masaüstü panel aynı sayıyı gösterir.

function Count({ id, fallback }: { id: string; fallback: number }) {
  return <span>{`${id}:${useCommentCount(id, fallback)}`}</span>;
}

afterEach(() => {
  cleanup();
  resetCommentCounts();
});

describe("useCommentCount", () => {
  it("depoda yoksa akıştan gelen sayı; yazılınca her yerde değişir", () => {
    render(
      <>
        <Count id="a" fallback={3} />
        <Count id="a" fallback={3} />
        <Count id="b" fallback={7} />
      </>,
    );
    expect(screen.getAllByText("a:3")).toHaveLength(2);
    act(() => setCommentCount("a", 4));
    expect(screen.getAllByText("a:4")).toHaveLength(2);
    expect(screen.getByText("b:7")).toBeTruthy();
  });

  it("sayı negatif ya da kesirli olamaz", () => {
    setCommentCount("x", -2);
    expect(getCommentCount("x")).toBe(0);
    setCommentCount("x", 2.7);
    expect(getCommentCount("x")).toBe(2);
    expect(getCommentCount("yok")).toBeUndefined();
  });
});
