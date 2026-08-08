// @vitest-environment jsdom
import type { ElementIR } from "@editable-slides/slide-deck-ir";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StructuredDataPanel } from "./structured-data-panel.js";

const sourceLocation = { file: "deck.mdx", line: 1, column: 1 };
const sourceState = {
  editable: true,
  sourceHash: "fixture",
  sourceFile: "deck.mdx",
  slideIds: ["intro"],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderElement(element: Extract<ElementIR, { type: "table" | "chart" }>) {
  act(() => {
    root.render(
      <StructuredDataPanel
        deckId="fixture"
        element={element}
        onSaved={() => undefined}
        slideId="intro"
        sourceState={sourceState}
      />,
    );
  });
}

function control<T extends Element>(label: string): T {
  const element = [...container.querySelectorAll("[aria-label]")].find(
    (candidate) => candidate.getAttribute("aria-label") === label,
  );
  if (!element) throw new Error(`Control not found: ${label}`);
  return element as T;
}

function button(label: string): HTMLButtonElement {
  const element = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!element) throw new Error(`Button not found: ${label}`);
  return element;
}

describe("StructuredDataPanel", () => {
  it("shows detailed table sizing and cell controls without flattening values", () => {
    const table: Extract<ElementIR, { type: "table" }> = {
      id: "table",
      type: "table",
      frame: { x: 0, y: 0, w: 600, h: 300 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      sourceLocation,
      headerRows: 0,
      columnWidths: [200, 400],
      rows: [
        {
          height: 80,
          cells: [
            {
              value: 1200,
              numberFormat: "currency-jpy",
              paragraphs: [{ runs: [{ text: "¥1,200" }] }],
              fill: { type: "solid", color: "#FFF4CC" },
              textStyle: { align: "right", verticalAlign: "bottom" },
            },
            { value: true, paragraphs: [{ runs: [{ text: "true" }] }] },
          ],
        },
      ],
      style: {
        border: { color: "#CCCCCC", width: 1 },
        headerFill: { type: "solid", color: "#EEEEEE" },
        bodyFill: { type: "solid", color: "#FFFFFF" },
        text: {
          fontFace: "Noto Sans JP",
          fontSize: 20,
          color: "#111111",
          fontWeight: 400,
          align: "left",
          verticalAlign: "top",
        },
      },
    };

    renderElement(table);

    expect(control<HTMLInputElement>("1列目の幅").value).toBe("200");
    expect(control<HTMLInputElement>("1行目の高さ").value).toBe("80");
    expect(control<HTMLInputElement>("1行1列").value).toBe("1200");
    expect(control<HTMLInputElement>("1行1列の背景色").value).toBe("#FFF4CC");
    expect(control<HTMLSelectElement>("1行1列の横位置").value).toBe("right");
    expect(control<HTMLSelectElement>("1行1列の縦位置").value).toBe("bottom");
    expect(control<HTMLSelectElement>("1行1列の数値形式").value).toBe("currency-jpy");
    expect(control<HTMLInputElement>("1行1列の横結合数").max).toBe("100");
    expect(control<HTMLInputElement>("1行1列の縦結合数").max).toBe("100");
  });

  it("disables row and column structure changes while merged cells exist", () => {
    const table: Extract<ElementIR, { type: "table" }> = {
      id: "merged-table",
      type: "table",
      frame: { x: 0, y: 0, w: 600, h: 300 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      sourceLocation,
      headerRows: 1,
      columnWidths: [300, 300],
      rows: [
        {
          cells: [
            {
              value: "見出し",
              paragraphs: [{ runs: [{ text: "見出し" }] }],
              colSpan: 2,
            },
          ],
        },
      ],
      style: {
        border: { color: "#CCCCCC", width: 1 },
        headerFill: { type: "solid", color: "#EEEEEE" },
        bodyFill: { type: "solid", color: "#FFFFFF" },
        text: {
          fontFace: "Noto Sans JP",
          fontSize: 20,
          color: "#111111",
          fontWeight: 400,
          align: "left",
          verticalAlign: "top",
        },
      },
    };

    renderElement(table);

    expect(container.textContent).toContain("結合セルがある間は行・列を変更できません");
    expect(button("行を追加").disabled).toBe(true);
    expect(button("列を追加").disabled).toBe(true);
    expect(button("末尾の行を削除").disabled).toBe(true);
    expect(button("末尾の列を削除").disabled).toBe(true);
  });

  it("shows combo type, axis, legend and data-label controls", () => {
    const chart: Extract<ElementIR, { type: "chart" }> = {
      id: "chart",
      type: "chart",
      frame: { x: 0, y: 0, w: 600, h: 300 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      sourceLocation,
      chartType: "combo",
      categoryAxisTitle: "月",
      valueAxisTitle: "売上",
      valueUnit: "万円",
      legendPosition: "right",
      series: [
        {
          name: "売上",
          labels: ["1月"],
          values: [10],
          color: "#123456",
          chartType: "bar",
        },
      ],
      style: {
        colors: ["#999999"],
        showLegend: true,
        showTitle: false,
        showValue: true,
        showCategoryName: true,
      },
    };

    renderElement(chart);

    expect(control<HTMLInputElement>("横軸タイトル").value).toBe("月");
    expect(control<HTMLInputElement>("縦軸タイトル").value).toBe("売上");
    expect(control<HTMLInputElement>("単位").value).toBe("万円");
    expect(control<HTMLSelectElement>("凡例位置").value).toBe("right");
    expect(control<HTMLInputElement>("凡例を表示").checked).toBe(true);
    expect(control<HTMLInputElement>("値ラベルを表示").checked).toBe(true);
    expect(control<HTMLInputElement>("項目名ラベルを表示").checked).toBe(true);
    expect(control<HTMLInputElement>("系列1の色").value).toBe("#123456");
    expect(control<HTMLSelectElement>("系列1のグラフ種類").value).toBe("bar");
  });

  it("guides and rejects unsupported chart data before sending a save", async () => {
    const chart = (
      chartType: "bar" | "pie" | "scatter" | "combo",
      series: Extract<ElementIR, { type: "chart" }>["series"],
    ): Extract<ElementIR, { type: "chart" }> => ({
      id: `chart-${chartType}`,
      type: "chart",
      frame: { x: 0, y: 0, w: 600, h: 300 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      sourceLocation,
      chartType,
      series,
      style: {
        colors: ["#3366FF"],
        showLegend: true,
        showTitle: false,
        showValue: false,
        showCategoryName: false,
      },
    });
    const save = async () => {
      await act(async () => {
        button("データを保存").click();
        await Promise.resolve();
      });
    };

    renderElement(
      chart("combo", [
        {
          name: "XY",
          labels: ["1"],
          values: [2],
          chartType: "scatter",
        },
      ]),
    );
    const type = control<HTMLSelectElement>("系列1のグラフ種類");
    expect([...type.options].some((option) => option.value === "scatter")).toBe(false);
    expect(container.textContent).toContain("複合グラフの散布図系列は保存できません");
    await save();
    expect(container.textContent).toContain("棒・折れ線・面のいずれかへ変更");

    renderElement(
      chart("scatter", [{ name: "XY", labels: ["not-a-number"], values: [2] }]),
    );
    expect(control<HTMLInputElement>("系列1の項目1").placeholder).toBe("X座標");
    expect(container.textContent).toContain("X座標となる数値");
    await save();
    expect(container.textContent).toContain("有限の数値");

    renderElement(
      chart("bar", [
        { name: "A", labels: ["1", "2"], values: [1, 2] },
        { name: "B", labels: ["1", "3"], values: [3, 4] },
      ]),
    );
    expect(container.textContent).toContain("同じ順序・内容");
    await save();
    expect(container.textContent).toContain("全系列の項目名");

    renderElement(chart("pie", [{ name: "A", labels: ["1"], values: [-1] }]));
    expect(control<HTMLInputElement>("系列1の値1").min).toBe("0");
    await save();
    expect(container.textContent).toContain("0以上");
  });

  it("keeps pie and doughnut editing to one series", () => {
    const chart: Extract<ElementIR, { type: "chart" }> = {
      id: "pie-chart",
      type: "chart",
      frame: { x: 0, y: 0, w: 600, h: 300 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      sourceLocation,
      chartType: "pie",
      series: [{ name: "構成", labels: ["A"], values: [1] }],
      style: {
        colors: ["#3366FF"],
        showLegend: true,
        showTitle: false,
        showValue: false,
        showCategoryName: false,
      },
    };

    renderElement(chart);

    expect(container.textContent).toContain(
      "円グラフとドーナツグラフは1系列で編集します。",
    );
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "系列を追加",
      ),
    ).toBe(false);
    expect(
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "系列を削除",
      )?.disabled,
    ).toBe(true);
  });
});
