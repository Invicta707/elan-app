// @vitest-environment happy-dom
//
// Ekspertiz: durum rozetleri (boş kare işaret yok; olumlu zümrüt + onay,
// boya/tramer amber, değişen/ağır hasar kırmızı) ve boya/değişen şeması
// (13 parça, ekspertiz renkleri, ipucu, açıklama, parça bilgisi yokken
// "belirtilmemiş"). Parça verisi vehicles.expertise_summary.parts.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import BodyDiagram, { STATE_COLORS, tooltipPosition } from "../components/vehicle/BodyDiagram";
import ConditionList, { conditionItems } from "../components/vehicle/ConditionList";
import { BODY_PARTS, bodyPartStates, bodyPartsUnknown, parseBodyParts } from "./body-parts";

afterEach(() => {
  cleanup();
});

const clean = { paintedPartsCount: 0, changedPartsCount: 0, tramerAmount: 0, hasHeavyDamage: false };

describe("parça verisi (expertise_summary.parts)", () => {
  it("geçerli parçalar okunur; bilinmeyen parça ya da durum yok sayılır; boşsa null", () => {
    expect(parseBodyParts({ parts: { hood: "painted", trunk: "changed", wing: "painted", roof: "yellow", front_bumper: "local_paint" } })).toEqual({
      hood: "painted",
      trunk: "changed",
      front_bumper: "local_paint",
    });
    for (const summary of [null, {}, "x", { parts: [] }, { parts: { wing: "painted" } }, { parts: null }]) {
      expect(parseBodyParts(summary)).toBeNull();
    }
  });

  it("şemadaki durum: parça listesi varsa ondan (listede olmayan orijinal); yoksa sayılardan kesin olan", () => {
    const withParts = bodyPartStates({ paintedPartsCount: 2, changedPartsCount: 0 }, { hood: "painted" });
    expect(withParts.hood).toBe("painted");
    expect(withParts.roof).toBe("original");
    expect(Object.keys(withParts)).toHaveLength(13);

    expect(Object.values(bodyPartStates({ paintedPartsCount: 0, changedPartsCount: 0 }, null)).every((s) => s === "original")).toBe(true);
    expect(Object.values(bodyPartStates({ paintedPartsCount: 1, changedPartsCount: 0 }, null)).every((s) => s === "unknown")).toBe(true);
    expect(bodyPartsUnknown({ paintedPartsCount: 1, changedPartsCount: 0 }, null)).toBe(true);
    expect(bodyPartsUnknown({ paintedPartsCount: 1, changedPartsCount: 0 }, { hood: "painted" })).toBe(false);
  });
});

describe("ekspertiz rozetleri", () => {
  it("dört durum; olumlu, amber ve kırmızı tonlar", () => {
    expect(conditionItems(clean)).toEqual([
      { label: "Boyasız", tone: "positive" },
      { label: "Değişensiz", tone: "positive" },
      { label: "Tramer kaydı yok", tone: "positive" },
      { label: "Ağır hasar kaydı yok", tone: "positive" },
    ]);
    expect(conditionItems({ paintedPartsCount: 2, changedPartsCount: 1, tramerAmount: 12_500, hasHeavyDamage: true })).toEqual([
      { label: "2 parça boyalı", tone: "warning" },
      { label: "1 parça değişen", tone: "danger" },
      { label: "Tramer ₺12.500", tone: "warning" },
      { label: "Ağır hasar kayıtlı", tone: "danger" },
    ]);
  });

  it("koyu zeminde zümrüt/amber/kırmızı rozet ve simge; boş kare işaret yok", () => {
    render(<ConditionList vehicle={{ ...clean, paintedPartsCount: 2, changedPartsCount: 1 }} tone="dark" />);
    const list = screen.getByRole("list", { name: "Ekspertiz özeti" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["2 parça boyalı", "1 parça değişen", "Tramer kaydı yok", "Ağır hasar kaydı yok"]);
    const positive = items[2];
    expect(positive.className).toContain("bg-emerald-950/40");
    expect(positive.className).toContain("text-emerald-400");
    expect(positive.className).toContain("border-emerald-800/40");
    expect(positive.querySelector("svg")?.getAttribute("class")).toContain("h-[13px]");
    expect(items[0].className).toContain("text-amber-400");
    expect(items[1].className).toContain("text-red-400");
    // Eski işaret: içi boş, açık gri kare
    expect(list.querySelector(".bg-\\[\\#E9ECEF\\]")).toBeNull();
    for (const item of items) expect(item.querySelectorAll("svg")).toHaveLength(1);
  });

  it("açık zeminde (mobil detay penceresi) okunur karşılıklar", () => {
    render(<ConditionList vehicle={clean} tone="light" />);
    const item = screen.getByText("Boyasız");
    expect(item.className).toContain("bg-emerald-50");
    expect(item.className).toContain("text-emerald-800");
  });
});

describe("boya / değişen şeması", () => {
  const counts = { paintedPartsCount: 2, changedPartsCount: 1 };
  const parts = { hood: "painted", front_bumper: "local_paint", trunk: "changed" } as const;

  it("13 parça ekspertiz renkleriyle; her parçanın erişilebilir adı ve durumu", () => {
    const { container } = render(<BodyDiagram counts={counts} parts={parts} tone="dark" />);
    const rects = container.querySelectorAll("[data-part]");
    expect(rects).toHaveLength(BODY_PARTS.length);
    const hood = container.querySelector("[data-part='hood']")!;
    expect(hood.getAttribute("fill")).toBe(STATE_COLORS.painted.dark);
    expect(hood.getAttribute("aria-label")).toBe("Kaput: Boyalı");
    expect(container.querySelector("[data-part='front_bumper']")!.getAttribute("fill")).toBe(STATE_COLORS.local_paint.dark);
    expect(container.querySelector("[data-part='trunk']")!.getAttribute("fill")).toBe(STATE_COLORS.changed.dark);
    expect(container.querySelector("[data-part='roof']")!.getAttribute("fill")).toBe(STATE_COLORS.original.dark);
    expect([STATE_COLORS.original.dark, STATE_COLORS.local_paint.dark, STATE_COLORS.painted.dark, STATE_COLORS.changed.dark]).toEqual([
      "#22C55E",
      "#EAB308",
      "#F97316",
      "#EF4444",
    ]);
    for (const part of BODY_PARTS) expect(screen.getByRole("img", { name: new RegExp(`^${part.label}: `) })).toBeTruthy();
  });

  it("dokununca ipucu: parça adı ve durumu; ikinci dokunuş kapatır; odakla da açılır", () => {
    const { container } = render(<BodyDiagram counts={counts} parts={parts} tone="light" />);
    const hood = container.querySelector("[data-part='hood']")!;
    fireEvent.click(hood);
    expect(container.querySelector("[data-part-tooltip]")?.textContent).toBe("Kaput · Boyalı");
    fireEvent.click(hood);
    expect(container.querySelector("[data-part-tooltip]")).toBeNull();

    fireEvent.focus(container.querySelector("[data-part='left_front_door']")!);
    expect(container.querySelector("[data-part-tooltip]")?.textContent).toBe("Sol ön kapı · Orijinal");
    fireEvent.blur(container.querySelector("[data-part='left_front_door']")!);
    expect(container.querySelector("[data-part-tooltip]")).toBeNull();
  });

  it("fareyle üstüne gelince açılır; dokunmatik geçiş (pointerenter) açmaz", () => {
    const { container } = render(<BodyDiagram counts={counts} parts={parts} tone="dark" />);
    const trunk = container.querySelector("[data-part='trunk']")!;
    fireEvent.pointerEnter(trunk, { pointerType: "touch" });
    expect(container.querySelector("[data-part-tooltip]")).toBeNull();
    fireEvent.pointerEnter(trunk, { pointerType: "mouse" });
    expect(container.querySelector("[data-part-tooltip]")?.textContent).toBe("Bagaj kapağı · Değişen");
  });

  it("ipucu kenardaki parçada şemanın içinde kalır", () => {
    expect(tooltipPosition({ x: 424, y: 40, w: 26, h: 140, r: 12 }).transform).toContain("-100%,");
    expect(tooltipPosition({ x: 10, y: 40, w: 26, h: 140, r: 12 }).transform).toContain("translate(0%,");
    expect(tooltipPosition({ x: 154, y: 54, w: 130, h: 112, r: 10 }).transform).toContain("-50%,");
  });

  it("renk açıklaması; parça bilgisi yoksa ve sayılar sıfır değilse 'Belirtilmemiş' ve not", () => {
    const first = render(<BodyDiagram counts={counts} parts={parts} tone="dark" />);
    const legend = screen.getByRole("list", { name: "Renklerin anlamı" });
    expect(within(legend).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Orijinal", "Lokal boyalı", "Boyalı", "Değişen"]);
    first.unmount();

    const { container } = render(<BodyDiagram counts={counts} parts={null} tone="dark" />);
    expect(container.querySelector("[data-part='hood']")!.getAttribute("data-state")).toBe("unknown");
    expect(within(screen.getByRole("list", { name: "Renklerin anlamı" })).getByText("Belirtilmemiş")).toBeTruthy();
    expect(screen.getByText(/Satıcı parça bilgisi girmedi/)).toBeTruthy();
  });

  it("hasarsız araçta (sayılar sıfır) parça bilgisi olmasa da bütün parçalar orijinal", () => {
    const { container } = render(<BodyDiagram counts={{ paintedPartsCount: 0, changedPartsCount: 0 }} parts={undefined} tone="light" />);
    expect([...container.querySelectorAll("[data-part]")].every((rect) => rect.getAttribute("data-state") === "original")).toBe(true);
    expect(screen.queryByText(/Satıcı parça bilgisi girmedi/)).toBeNull();
  });
});
