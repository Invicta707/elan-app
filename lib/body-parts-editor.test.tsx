// @vitest-environment happy-dom
//
// /sell boya / değişen seçici (components/sell/BodyPartsEditor.tsx) ve yazma
// mantığı (lib/body-parts.ts: setBodyPart, bodyPartCounts, expertiseSummary).
// Asıl güvence: /sell'in yazdığı expertise_summary, ilan detayındaki şemanın
// okuma mantığıyla (parseBodyParts + bodyPartStates) birebir aynı sonucu verir.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BodyPartsEditor from "../components/sell/BodyPartsEditor";
import BodyDiagram from "../components/vehicle/BodyDiagram";
import {
  BODY_PARTS,
  BODY_PART_STATUSES,
  bodyPartCounts,
  bodyPartStates,
  bodyPartsSummary,
  bodyPartsUnknown,
  expertiseSummary,
  parseBodyParts,
  setBodyPart,
  type BodyPartMap,
  type BodyPartStatus,
} from "./body-parts";

afterEach(() => {
  cleanup();
});

describe("yazma mantığı", () => {
  it("setBodyPart: orijinal seçilince parça listeden çıkar; diğer durumlar yazılır; girdi değişmez", () => {
    const start: BodyPartMap = { hood: "painted" };
    expect(setBodyPart(start, "trunk", "changed")).toEqual({ hood: "painted", trunk: "changed" });
    expect(setBodyPart(start, "hood", "local_paint")).toEqual({ hood: "local_paint" });
    expect(setBodyPart(start, "hood", "original")).toEqual({});
    expect(start).toEqual({ hood: "painted" });
  });

  it("bodyPartCounts: lokal boya da boyalı sayılır; değişen ayrı", () => {
    expect(bodyPartCounts({})).toEqual({ paintedPartsCount: 0, changedPartsCount: 0 });
    expect(
      bodyPartCounts({ hood: "painted", front_bumper: "local_paint", trunk: "changed", roof: "original" }),
    ).toEqual({ paintedPartsCount: 2, changedPartsCount: 1 });
  });

  it("expertiseSummary: yalnızca orijinal olmayanlar, BODY_PARTS sırasıyla; bozuk durum atılır", () => {
    const summary = expertiseSummary({
      trunk: "changed",
      roof: "original",
      hood: "painted",
      front_bumper: "local_paint",
      left_front_door: "bent" as BodyPartStatus,
    });
    expect(summary).toEqual({ parts: { front_bumper: "local_paint", hood: "painted", trunk: "changed" } });
    expect(JSON.stringify(summary)).toBe('{"parts":{"front_bumper":"local_paint","hood":"painted","trunk":"changed"}}');
    expect(expertiseSummary({})).toEqual({ parts: {} });
  });

  it("bodyPartsSummary: özet kartı ve seçicinin satırı", () => {
    expect(bodyPartsSummary({})).toBe("Bütün parçalar orijinal");
    expect(bodyPartsSummary({ hood: "painted" })).toBe("1 parça boyalı · Değişensiz");
    expect(bodyPartsSummary({ trunk: "changed" })).toBe("Boyasız · 1 parça değişen");
    expect(bodyPartsSummary({ hood: "local_paint", roof: "painted", trunk: "changed" })).toBe("2 parça boyalı · 1 parça değişen");
  });
});

// Deterministik sözde rastgele: her çalıştırmada aynı seçimler
function* randomMaps(count: number): Generator<BodyPartMap> {
  let seed = 20260929;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
  for (let i = 0; i < count; i += 1) {
    const map: BodyPartMap = {};
    for (const { key } of BODY_PARTS) {
      const status = BODY_PART_STATUSES[next() % BODY_PART_STATUSES.length];
      if (next() % 3 !== 0) map[key] = status;
    }
    yield map;
  }
}

describe("/sell'in yazdığı ↔ ilan detayının okuduğu", () => {
  const cases: BodyPartMap[] = [
    {},
    ...BODY_PARTS.flatMap(({ key }) => BODY_PART_STATUSES.map((status) => ({ [key]: status }) as BodyPartMap)),
    Object.fromEntries(BODY_PARTS.map(({ key }) => [key, "changed"])) as BodyPartMap,
    ...randomMaps(400),
  ];

  it(`${cases.length} seçimde: kaydedilen JSON geri okununca her parça seçilen durumda, sayılar tutarlı, "belirtilmemiş" yok`, () => {
    for (const selection of cases) {
      // İstemci → PostgREST (JSON) → jsonb → detay sorgusu (JSON)
      const stored = JSON.parse(JSON.stringify(expertiseSummary(selection)));
      const counts = bodyPartCounts(selection);
      const parts = parseBodyParts(stored);
      const states = bodyPartStates(counts, parts);
      for (const { key } of BODY_PARTS) {
        expect(states[key], `${key} ${JSON.stringify(selection)}`).toBe(selection[key] ?? "original");
      }
      expect(bodyPartsUnknown(counts, parts)).toBe(false);
      // Veritabanı sayıları listeden yeniden hesaplar: okunan listeden de aynı sayılar çıkar
      expect(bodyPartCounts(parts ?? {})).toEqual(counts);
    }
  });

  it("seçicide görülen şema ile ilan detayındaki şema aynı renkleri çizer", () => {
    const selection: BodyPartMap = { hood: "painted", front_bumper: "local_paint", right_rear_door: "changed" };
    const editor = render(<BodyPartsEditor id="e" value={selection} onChange={vi.fn()} />);
    const drawn = (root: HTMLElement) =>
      Object.fromEntries([...root.querySelectorAll("rect[data-part]")].map((rect) => [rect.getAttribute("data-part"), rect.getAttribute("fill")]));
    const editorFills = drawn(editor.container);
    editor.unmount();

    const stored = JSON.parse(JSON.stringify(expertiseSummary(selection)));
    const detail = render(<BodyDiagram counts={bodyPartCounts(selection)} parts={parseBodyParts(stored)} tone="light" />);
    expect(drawn(detail.container)).toEqual(editorFills);
    expect(Object.keys(editorFills)).toHaveLength(13);
  });
});

/** /sell'deki gibi kontrollü kullanım */
function Harness({ initial = {}, onChange }: { initial?: BodyPartMap; onChange?: (next: BodyPartMap) => void }) {
  const [value, setValue] = useState<BodyPartMap>(initial);
  return (
    <BodyPartsEditor
      id="sell-bodyParts"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const part = (name: string) => screen.getByRole("button", { name });

describe("BodyPartsEditor", () => {
  it("13 parça dokunulabilir; başlangıçta hepsi orijinal, özet 'Bütün parçalar orijinal'", () => {
    const { container } = render(<Harness />);
    const svg = screen.getByRole("group", { name: /Boya ve değişen seçici/ });
    expect(within(svg).getAllByRole("button")).toHaveLength(13);
    for (const { label } of BODY_PARTS) expect(part(`${label}: Orijinal`)).toBeTruthy();
    expect(container.querySelector("[data-body-summary]")?.textContent).toBe("Bütün parçalar orijinal");
    expect(screen.getByRole("button", { name: /Tümünü orijinal yap/ })).toHaveProperty("disabled", true);
    expect(screen.getByText("Boyalı ya da değişen parçaya dokunup durumunu seç.")).toBeTruthy();
  });

  it("parçaya dokununca dört durumlu seçim açılır; seçilen durum şemaya, özete ve değere yansır", () => {
    const onChange = vi.fn();
    const { container } = render(<Harness onChange={onChange} />);
    fireEvent.click(part("Kaput: Orijinal"));
    const picker = screen.getByRole("radiogroup", { name: "Kaput" });
    expect(within(picker).getAllByRole("radio").map((radio) => radio.textContent)).toEqual([
      "OrijinalFabrika boyası",
      "Lokal boyalıBir bölgesi boyalı",
      "BoyalıParçanın tamamı",
      "DeğişenParça yenilendi",
    ]);
    expect(within(picker).getByRole("radio", { name: /^Orijinal/ }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(within(picker).getByRole("radio", { name: /^Boyalı/ }));
    expect(onChange).toHaveBeenLastCalledWith({ hood: "painted" });
    expect(part("Kaput: Boyalı").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('rect[data-part="hood"]')?.getAttribute("data-state")).toBe("painted");
    expect(container.querySelector("[data-body-summary]")?.textContent).toBe("1 parça boyalı · Değişensiz");
    expect(within(screen.getByRole("list", { name: "Orijinal olmayan parçalar" })).getByText("Kaput · Boyalı")).toBeTruthy();
  });

  it("klavyeyle (Enter / boşluk) parça seçilir; Değişen ve Orijinal'e dönüş", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(part("Bagaj kapağı: Orijinal"), { key: "Enter" });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Bagaj kapağı" })).getByRole("radio", { name: /^Değişen/ }));
    expect(onChange).toHaveBeenLastCalledWith({ trunk: "changed" });

    fireEvent.keyDown(part("Tavan: Orijinal"), { key: " " });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Tavan" })).getByRole("radio", { name: /^Lokal boyalı/ }));
    expect(onChange).toHaveBeenLastCalledWith({ trunk: "changed", roof: "local_paint" });

    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Tavan" })).getByRole("radio", { name: /^Orijinal/ }));
    expect(onChange).toHaveBeenLastCalledWith({ trunk: "changed" });
  });

  it("orijinal olmayan parça hapı o parçayı seçer; 'Tamam' menüyü kapatır; 'Tümünü orijinal yap' sıfırlar", () => {
    const onChange = vi.fn();
    const { container } = render(<Harness initial={{ hood: "painted", left_front_door: "changed" }} onChange={onChange} />);
    expect(container.querySelector("[data-body-summary]")?.textContent).toBe("1 parça boyalı · 1 parça değişen");

    fireEvent.click(screen.getByRole("button", { name: /Sol ön kapı · Değişen/ }));
    expect(screen.getByRole("radiogroup", { name: "Sol ön kapı" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tamam" }));
    expect(screen.queryByRole("radiogroup")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Tümünü orijinal yap/ }));
    expect(onChange).toHaveBeenLastCalledWith({});
    expect(container.querySelector("[data-body-summary]")?.textContent).toBe("Bütün parçalar orijinal");
    expect(screen.queryByRole("list", { name: "Orijinal olmayan parçalar" })).toBeNull();
  });

  it("dokunma alanları görünen parçadan geniş ve birbiriyle çakışmıyor", () => {
    const { container } = render(<Harness />);
    const hits = [...container.querySelectorAll("rect[data-hit]")].map((rect) => {
      const [x, y, w, h] = ["x", "y", "width", "height"].map((name) => Number(rect.getAttribute(name)));
      return { key: rect.getAttribute("data-hit"), x, y, w, h };
    });
    expect(hits).toHaveLength(13);
    for (const hit of hits) {
      const shape = container.querySelector(`rect[data-part="${hit.key}"]`)!;
      const [x, y, w, h] = ["x", "y", "width", "height"].map((name) => Number(shape.getAttribute(name)));
      expect(hit.x <= x && hit.y <= y && hit.x + hit.w >= x + w && hit.y + hit.h >= y + h, String(hit.key)).toBe(true);
    }
    for (const a of hits) {
      for (const b of hits) {
        if (a.key === b.key) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.key} × ${b.key}`).toBe(false);
      }
    }
  });
});
