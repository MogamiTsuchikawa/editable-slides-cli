import {
  type ChartContractIssueCode,
  type ElementIR,
  MAX_TABLE_CELL_SPAN,
  validateChartContract,
} from "@livetoon/slide-deck-ir";
import { useEffect, useState } from "react";

import { type DeckSourceState, saveStructuredData } from "./api.js";

type StructuredElement = Extract<ElementIR, { type: "table" | "chart" }>;
type ChartSeries = Extract<ElementIR, { type: "chart" }>["series"][number];

interface TableCellDraft {
  draftId: string;
  value: string | number | boolean | null;
  valueType: "text" | "number" | "boolean" | "empty";
  fill: string;
  align: "" | "left" | "center" | "right";
  verticalAlign: "" | "top" | "middle" | "bottom";
  colSpan: string;
  rowSpan: string;
  numberFormat: "" | "integer" | "decimal" | "percent" | "currency-jpy";
}

interface TableRowDraft {
  draftId: string;
  cells: TableCellDraft[];
  height: string;
}

interface ChartSeriesDraft extends ChartSeries {
  draftId: string;
  pointIds: string[];
}

interface ChartSettingsDraft {
  categoryAxisTitle: string;
  valueAxisTitle: string;
  valueUnit: string;
  showLegend: boolean;
  legendPosition: "top" | "bottom" | "left" | "right";
  showValue: boolean;
  showCategoryName: boolean;
}

const DEFAULT_CHART_SETTINGS: ChartSettingsDraft = {
  categoryAxisTitle: "",
  valueAxisTitle: "",
  valueUnit: "",
  showLegend: false,
  legendPosition: "bottom",
  showValue: false,
  showCategoryName: false,
};

function draftId(): string {
  return crypto.randomUUID();
}

function cellText(
  cell: Extract<ElementIR, { type: "table" }>["rows"][number]["cells"][number],
) {
  return cell.paragraphs
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
    .join("\n");
}

function scalarType(value: string | number | boolean | null) {
  if (value === null) return "empty" as const;
  if (typeof value === "number") return "number" as const;
  if (typeof value === "boolean") return "boolean" as const;
  return "text" as const;
}

function solidFillColor(
  fill: Extract<ElementIR, { type: "table" }>["rows"][number]["cells"][number]["fill"],
): string {
  return fill?.type === "solid" ? fill.color : "";
}

function emptyCellDraft(): TableCellDraft {
  return {
    draftId: draftId(),
    value: "",
    valueType: "text",
    fill: "",
    align: "",
    verticalAlign: "",
    colSpan: "1",
    rowSpan: "1",
    numberFormat: "",
  };
}

function cellDraftValue(cell: TableCellDraft): string | number | boolean | null {
  if (cell.valueType === "empty") return null;
  if (cell.valueType === "boolean") {
    return cell.value === true || String(cell.value).toLowerCase() === "true";
  }
  if (cell.valueType === "number" || cell.numberFormat) {
    const number = Number(cell.value);
    if (!Number.isFinite(number))
      throw new Error("数値セルには数値を入力してください。");
    return number;
  }
  return String(cell.value ?? "");
}

function serializeTableCell(cell: TableCellDraft): unknown {
  const value = cellDraftValue(cell);
  const colSpan = Number(cell.colSpan || 1);
  const rowSpan = Number(cell.rowSpan || 1);
  const hasDetails = Boolean(
    cell.fill ||
      cell.align ||
      cell.verticalAlign ||
      colSpan !== 1 ||
      rowSpan !== 1 ||
      cell.numberFormat,
  );
  if (!hasDetails) return value;
  return {
    value,
    ...(cell.fill.trim() ? { fill: cell.fill.trim() } : {}),
    ...(cell.align ? { align: cell.align } : {}),
    ...(cell.verticalAlign ? { verticalAlign: cell.verticalAlign } : {}),
    ...(colSpan !== 1 ? { colSpan } : {}),
    ...(rowSpan !== 1 ? { rowSpan } : {}),
    ...(cell.numberFormat ? { numberFormat: cell.numberFormat } : {}),
  };
}

function chartContractMessage(code: ChartContractIssueCode): string {
  switch (code) {
    case "single-series-required":
      return "円グラフとドーナツグラフは1系列で入力してください。";
    case "combo-scatter-unsupported":
      return "複合グラフでは散布図系列を使用できません。棒・折れ線・面のいずれかへ変更してください。";
    case "category-labels-mismatch":
      return "全系列の項目名を同じ順序・内容に揃えてください。";
    case "pie-negative-value":
      return "円グラフとドーナツグラフの値は0以上で入力してください。";
    case "pie-all-zero":
      return "円グラフとドーナツグラフには0より大きい値を1件以上入力してください。";
    case "scatter-label-not-numeric":
      return "散布図の項目にはX座標となる有限の数値を入力してください。";
  }
}

export function StructuredDataPanel({
  deckId,
  element,
  onSaved,
  slideId,
  sourceState,
}: {
  deckId: string;
  element: StructuredElement;
  onSaved: (state: DeckSourceState) => void;
  slideId: string;
  sourceState?: DeckSourceState;
}) {
  const [rows, setRows] = useState<TableRowDraft[]>([]);
  const [columnWidths, setColumnWidths] = useState<string[]>([]);
  const [columnWidthIds, setColumnWidthIds] = useState<string[]>([]);
  const [series, setSeries] = useState<ChartSeriesDraft[]>([]);
  const [chartSettings, setChartSettings] =
    useState<ChartSettingsDraft>(DEFAULT_CHART_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const hasMergedCells =
    element.type === "table" &&
    rows.some((row) =>
      row.cells.some((cell) => Number(cell.colSpan) > 1 || Number(cell.rowSpan) > 1),
    );

  useEffect(() => {
    if (element.type === "table") {
      const hasRowHeights = element.rows.some((row) => row.height !== undefined);
      const defaultRowHeight = element.frame.h / Math.max(1, element.rows.length);
      setRows(
        element.rows.map((row) => ({
          draftId: draftId(),
          height:
            row.height === undefined
              ? hasRowHeights
                ? String(defaultRowHeight)
                : ""
              : String(row.height),
          cells: row.cells.map((cell) => {
            const value = cell.value !== undefined ? cell.value : cellText(cell);
            return {
              draftId: draftId(),
              value,
              valueType: scalarType(value),
              fill: solidFillColor(cell.fill),
              align:
                cell.textStyle?.align === "left" ||
                cell.textStyle?.align === "center" ||
                cell.textStyle?.align === "right"
                  ? cell.textStyle.align
                  : "",
              verticalAlign: cell.textStyle?.verticalAlign ?? "",
              colSpan: String(cell.colSpan ?? 1),
              rowSpan: String(cell.rowSpan ?? 1),
              numberFormat: cell.numberFormat ?? "",
            };
          }),
        })),
      );
      const columnCount = element.rows.reduce(
        (maximum, row) =>
          Math.max(
            maximum,
            row.cells.reduce((count, cell) => count + (cell.colSpan ?? 1), 0),
          ),
        0,
      );
      setColumnWidths(
        Array.from({ length: columnCount }, (_, index) =>
          element.columnWidths?.[index] === undefined
            ? ""
            : String(element.columnWidths[index]),
        ),
      );
      setColumnWidthIds(Array.from({ length: columnCount }, draftId));
      setSeries([]);
      setChartSettings(DEFAULT_CHART_SETTINGS);
    } else {
      setRows([]);
      setColumnWidths([]);
      setColumnWidthIds([]);
      setSeries(
        element.series.map((entry) => ({
          ...entry,
          draftId: draftId(),
          labels: [...entry.labels],
          pointIds: entry.labels.map(() => draftId()),
          values: [...entry.values],
        })),
      );
      setChartSettings({
        categoryAxisTitle: element.categoryAxisTitle ?? "",
        valueAxisTitle: element.valueAxisTitle ?? "",
        valueUnit: element.valueUnit ?? "",
        showLegend: element.style.showLegend,
        legendPosition: element.legendPosition ?? "bottom",
        showValue: element.style.showValue,
        showCategoryName: element.style.showCategoryName,
      });
    }
    setMessage(undefined);
  }, [element]);

  const save = async () => {
    if (!sourceState?.editable) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const data =
        element.type === "table"
          ? {
              rows: rows.map((row) => row.cells.map(serializeTableCell)),
              ...(columnWidths.some((width) => width.trim())
                ? {
                    columnWidths: columnWidths.map((width) => {
                      const number = Number(width);
                      if (!Number.isFinite(number) || number <= 0) {
                        throw new Error(
                          "列幅はすべて0より大きい数値で入力してください。",
                        );
                      }
                      return number;
                    }),
                  }
                : {}),
              ...(rows.some((row) => row.height.trim())
                ? {
                    rowHeights: rows.map((row) => {
                      const number = Number(row.height);
                      if (!Number.isFinite(number) || number <= 0) {
                        throw new Error(
                          "行の高さはすべて0より大きい数値で入力してください。",
                        );
                      }
                      return number;
                    }),
                  }
                : {}),
            }
          : {
              series: series.map(
                ({ color, draftId: _draftId, pointIds: _pointIds, ...entry }) => ({
                  ...entry,
                  ...(color?.trim() ? { color: color.trim() } : {}),
                }),
              ),
              ...chartSettings,
            };
      if (element.type === "chart") {
        const chartData = data as { series: ChartSeries[] };
        const contract = validateChartContract(element.chartType, chartData.series);
        if (!contract.success) {
          throw new Error(chartContractMessage(contract.issue.code));
        }
      }
      onSaved(
        await saveStructuredData(
          deckId,
          slideId,
          element.id,
          sourceState.sourceHash,
          data,
        ),
      );
      setMessage("保存しました。資料へ反映しています。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const updateCell = (
    rowIndex: number,
    columnIndex: number,
    update: Partial<TableCellDraft>,
  ) => {
    setRows((value) =>
      value.map((entry, entryIndex) =>
        entryIndex === rowIndex
          ? {
              ...entry,
              cells: entry.cells.map((item, itemIndex) =>
                itemIndex === columnIndex ? { ...item, ...update } : item,
              ),
            }
          : entry,
      ),
    );
  };
  const singleSeriesChart =
    element.type === "chart" &&
    (element.chartType === "pie" || element.chartType === "doughnut");
  const scatterChart = element.type === "chart" && element.chartType === "scatter";
  const comboScatterSeries =
    element.type === "chart" &&
    element.chartType === "combo" &&
    series.some((entry) => entry.chartType === "scatter");

  return (
    <details className="studio-source-editor" open>
      <summary>{element.type === "table" ? "表のデータ" : "グラフのデータ"}</summary>
      <small className="studio-structured-id">{element.id}</small>
      {element.type === "table" ? (
        <>
          <fieldset className="studio-structured-settings">
            <legend>列幅</legend>
            <div className="studio-column-widths">
              {columnWidths.map((width, index) => (
                <label key={columnWidthIds[index]}>
                  {index + 1}列目
                  <input
                    aria-label={`${index + 1}列目の幅`}
                    disabled={!sourceState?.editable || saving}
                    min="1"
                    onChange={(event) =>
                      setColumnWidths((value) =>
                        value.map((entry, entryIndex) =>
                          entryIndex === index ? event.target.value : entry,
                        ),
                      )
                    }
                    placeholder="自動"
                    type="number"
                    value={width}
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <div className="studio-data-grid-scroll">
            <table className="studio-data-grid">
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={row.draftId}>
                    <th>
                      <label>
                        行高
                        <input
                          aria-label={`${rowIndex + 1}行目の高さ`}
                          disabled={!sourceState?.editable || saving}
                          min="1"
                          onChange={(event) =>
                            setRows((value) =>
                              value.map((entry, entryIndex) =>
                                entryIndex === rowIndex
                                  ? { ...entry, height: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                          placeholder="自動"
                          type="number"
                          value={row.height}
                        />
                      </label>
                    </th>
                    {row.cells.map((cell, columnIndex) => (
                      <td key={cell.draftId}>
                        <input
                          aria-label={`${rowIndex + 1}行${columnIndex + 1}列`}
                          disabled={!sourceState?.editable || saving}
                          onChange={(event) =>
                            updateCell(rowIndex, columnIndex, {
                              value: event.target.value,
                            })
                          }
                          value={String(cell.value ?? "")}
                        />
                        <details className="studio-cell-settings">
                          <summary>セル設定</summary>
                          <label>
                            値の種類
                            <select
                              aria-label={`${rowIndex + 1}行${columnIndex + 1}列の値の種類`}
                              disabled={!sourceState?.editable || saving}
                              onChange={(event) => {
                                const valueType = event.target
                                  .value as TableCellDraft["valueType"];
                                updateCell(rowIndex, columnIndex, {
                                  valueType,
                                  value:
                                    valueType === "empty"
                                      ? null
                                      : valueType === "boolean"
                                        ? false
                                        : valueType === "number"
                                          ? Number(cell.value) || 0
                                          : String(cell.value ?? ""),
                                });
                              }}
                              value={cell.valueType}
                            >
                              <option value="text">文字</option>
                              <option value="number">数値</option>
                              <option value="boolean">真偽値</option>
                              <option value="empty">空欄</option>
                            </select>
                          </label>
                          <label>
                            背景色
                            <input
                              aria-label={`${rowIndex + 1}行${columnIndex + 1}列の背景色`}
                              disabled={!sourceState?.editable || saving}
                              onChange={(event) =>
                                updateCell(rowIndex, columnIndex, {
                                  fill: event.target.value,
                                })
                              }
                              placeholder="#ffffff"
                              value={cell.fill}
                            />
                          </label>
                          <label>
                            横位置
                            <select
                              aria-label={`${rowIndex + 1}行${columnIndex + 1}列の横位置`}
                              disabled={!sourceState?.editable || saving}
                              onChange={(event) =>
                                updateCell(rowIndex, columnIndex, {
                                  align: event.target.value as TableCellDraft["align"],
                                })
                              }
                              value={cell.align}
                            >
                              <option value="">テーマ設定</option>
                              <option value="left">左</option>
                              <option value="center">中央</option>
                              <option value="right">右</option>
                            </select>
                          </label>
                          <label>
                            縦位置
                            <select
                              aria-label={`${rowIndex + 1}行${columnIndex + 1}列の縦位置`}
                              disabled={!sourceState?.editable || saving}
                              onChange={(event) =>
                                updateCell(rowIndex, columnIndex, {
                                  verticalAlign: event.target
                                    .value as TableCellDraft["verticalAlign"],
                                })
                              }
                              value={cell.verticalAlign}
                            >
                              <option value="">テーマ設定</option>
                              <option value="top">上</option>
                              <option value="middle">中央</option>
                              <option value="bottom">下</option>
                            </select>
                          </label>
                          <label>
                            横結合
                            <input
                              aria-label={`${rowIndex + 1}行${columnIndex + 1}列の横結合数`}
                              disabled={!sourceState?.editable || saving}
                              max={MAX_TABLE_CELL_SPAN}
                              min="1"
                              onChange={(event) =>
                                updateCell(rowIndex, columnIndex, {
                                  colSpan: event.target.value,
                                })
                              }
                              type="number"
                              value={cell.colSpan}
                            />
                          </label>
                          <label>
                            縦結合
                            <input
                              aria-label={`${rowIndex + 1}行${columnIndex + 1}列の縦結合数`}
                              disabled={!sourceState?.editable || saving}
                              max={MAX_TABLE_CELL_SPAN}
                              min="1"
                              onChange={(event) =>
                                updateCell(rowIndex, columnIndex, {
                                  rowSpan: event.target.value,
                                })
                              }
                              type="number"
                              value={cell.rowSpan}
                            />
                          </label>
                          <label>
                            数値形式
                            <select
                              aria-label={`${rowIndex + 1}行${columnIndex + 1}列の数値形式`}
                              disabled={!sourceState?.editable || saving}
                              onChange={(event) =>
                                updateCell(rowIndex, columnIndex, {
                                  numberFormat: event.target
                                    .value as TableCellDraft["numberFormat"],
                                })
                              }
                              value={cell.numberFormat}
                            >
                              <option value="">指定なし</option>
                              <option value="integer">整数（桁区切り）</option>
                              <option value="decimal">小数（2桁）</option>
                              <option value="percent">パーセント</option>
                              <option value="currency-jpy">日本円</option>
                            </select>
                          </label>
                        </details>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="studio-data-actions">
            {hasMergedCells ? (
              <p className="studio-source-message" role="status">
                結合セルがある間は行・列を変更できません。横結合と縦結合を1へ戻して保存してから変更してください。
              </p>
            ) : null}
            <button
              disabled={!sourceState?.editable || saving || hasMergedCells}
              onClick={() =>
                setRows((value) => [
                  ...value,
                  {
                    draftId: draftId(),
                    height: "",
                    cells: Array.from(
                      { length: Math.max(1, columnWidths.length) },
                      emptyCellDraft,
                    ),
                  },
                ])
              }
              type="button"
            >
              行を追加
            </button>
            <button
              disabled={!sourceState?.editable || saving || hasMergedCells}
              onClick={() => {
                setRows((value) =>
                  value.map((row) => ({
                    ...row,
                    cells: [...row.cells, emptyCellDraft()],
                  })),
                );
                setColumnWidths((value) => [...value, ""]);
                setColumnWidthIds((value) => [...value, draftId()]);
              }}
              type="button"
            >
              列を追加
            </button>
            <button
              disabled={
                !sourceState?.editable || saving || hasMergedCells || rows.length <= 1
              }
              onClick={() => setRows((value) => value.slice(0, -1))}
              type="button"
            >
              末尾の行を削除
            </button>
            <button
              disabled={
                !sourceState?.editable ||
                saving ||
                hasMergedCells ||
                (rows[0]?.cells.length ?? 0) <= 1
              }
              onClick={() => {
                setRows((value) =>
                  value.map((row) => ({ ...row, cells: row.cells.slice(0, -1) })),
                );
                setColumnWidths((value) => value.slice(0, -1));
                setColumnWidthIds((value) => value.slice(0, -1));
              }}
              type="button"
            >
              末尾の列を削除
            </button>
          </div>
        </>
      ) : (
        <>
          <fieldset className="studio-structured-settings studio-chart-settings">
            <legend>グラフ表示</legend>
            <label>
              横軸タイトル
              <input
                aria-label="横軸タイトル"
                disabled={!sourceState?.editable || saving}
                onChange={(event) =>
                  setChartSettings((value) => ({
                    ...value,
                    categoryAxisTitle: event.target.value,
                  }))
                }
                value={chartSettings.categoryAxisTitle}
              />
            </label>
            <label>
              縦軸タイトル
              <input
                aria-label="縦軸タイトル"
                disabled={!sourceState?.editable || saving}
                onChange={(event) =>
                  setChartSettings((value) => ({
                    ...value,
                    valueAxisTitle: event.target.value,
                  }))
                }
                value={chartSettings.valueAxisTitle}
              />
            </label>
            <label>
              単位
              <input
                aria-label="単位"
                disabled={!sourceState?.editable || saving}
                onChange={(event) =>
                  setChartSettings((value) => ({
                    ...value,
                    valueUnit: event.target.value,
                  }))
                }
                placeholder="万円"
                value={chartSettings.valueUnit}
              />
            </label>
            <label>
              凡例位置
              <select
                aria-label="凡例位置"
                disabled={!sourceState?.editable || saving}
                onChange={(event) =>
                  setChartSettings((value) => ({
                    ...value,
                    legendPosition: event.target
                      .value as ChartSettingsDraft["legendPosition"],
                  }))
                }
                value={chartSettings.legendPosition}
              >
                <option value="top">上</option>
                <option value="bottom">下</option>
                <option value="left">左</option>
                <option value="right">右</option>
              </select>
            </label>
            <label className="studio-check-field">
              <input
                aria-label="凡例を表示"
                checked={chartSettings.showLegend}
                disabled={!sourceState?.editable || saving}
                onChange={(event) =>
                  setChartSettings((value) => ({
                    ...value,
                    showLegend: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              凡例を表示
            </label>
            <label className="studio-check-field">
              <input
                aria-label="値ラベルを表示"
                checked={chartSettings.showValue}
                disabled={!sourceState?.editable || saving}
                onChange={(event) =>
                  setChartSettings((value) => ({
                    ...value,
                    showValue: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              値ラベルを表示
            </label>
            <label className="studio-check-field">
              <input
                aria-label="項目名ラベルを表示"
                checked={chartSettings.showCategoryName}
                disabled={!sourceState?.editable || saving}
                onChange={(event) =>
                  setChartSettings((value) => ({
                    ...value,
                    showCategoryName: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              項目名ラベルを表示
            </label>
          </fieldset>
          <div className="studio-chart-series-list">
            {series.map((entry, seriesIndex) => (
              <section className="studio-chart-series" key={entry.draftId}>
                <div className="studio-chart-series-head">
                  <input
                    aria-label={`系列${seriesIndex + 1}の名前`}
                    disabled={!sourceState?.editable || saving}
                    onChange={(event) =>
                      setSeries((value) =>
                        value.map((item, itemIndex) =>
                          itemIndex === seriesIndex
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      )
                    }
                    value={entry.name}
                  />
                  <input
                    aria-label={`系列${seriesIndex + 1}の色`}
                    disabled={!sourceState?.editable || saving}
                    onChange={(event) =>
                      setSeries((value) =>
                        value.map((item, itemIndex) =>
                          itemIndex === seriesIndex
                            ? { ...item, color: event.target.value }
                            : item,
                        ),
                      )
                    }
                    placeholder="#1769ff"
                    value={entry.color ?? ""}
                  />
                  {element.chartType === "combo" || entry.chartType ? (
                    <select
                      aria-label={`系列${seriesIndex + 1}のグラフ種類`}
                      disabled={!sourceState?.editable || saving}
                      onChange={(event) =>
                        setSeries((value) =>
                          value.map((item, itemIndex) =>
                            itemIndex === seriesIndex
                              ? {
                                  ...item,
                                  chartType: event.target
                                    .value as ChartSeriesDraft["chartType"],
                                }
                              : item,
                          ),
                        )
                      }
                      value={entry.chartType ?? (seriesIndex === 0 ? "bar" : "line")}
                    >
                      <option value="bar">棒</option>
                      <option value="line">折れ線</option>
                      <option value="area">面</option>
                      {element.chartType === "combo" ? null : (
                        <option value="scatter">散布図</option>
                      )}
                    </select>
                  ) : null}
                </div>
                {entry.labels.map((label, pointIndex) => (
                  <div className="studio-chart-point" key={entry.pointIds[pointIndex]}>
                    <input
                      aria-label={`系列${seriesIndex + 1}の項目${pointIndex + 1}`}
                      disabled={!sourceState?.editable || saving}
                      onChange={(event) =>
                        setSeries((value) =>
                          value.map((item, itemIndex) =>
                            itemIndex === seriesIndex
                              ? {
                                  ...item,
                                  labels: item.labels.map((current, currentIndex) =>
                                    currentIndex === pointIndex
                                      ? event.target.value
                                      : current,
                                  ),
                                }
                              : item,
                          ),
                        )
                      }
                      placeholder={scatterChart ? "X座標" : undefined}
                      value={label}
                    />
                    <input
                      aria-label={`系列${seriesIndex + 1}の値${pointIndex + 1}`}
                      disabled={!sourceState?.editable || saving}
                      onChange={(event) =>
                        setSeries((value) =>
                          value.map((item, itemIndex) =>
                            itemIndex === seriesIndex
                              ? {
                                  ...item,
                                  values: item.values.map((current, currentIndex) =>
                                    currentIndex === pointIndex
                                      ? Number(event.target.value)
                                      : current,
                                  ),
                                }
                              : item,
                          ),
                        )
                      }
                      min={singleSeriesChart ? 0 : undefined}
                      type="number"
                      value={entry.values[pointIndex] ?? 0}
                    />
                  </div>
                ))}
                <div className="studio-data-actions">
                  <button
                    disabled={!sourceState?.editable || saving}
                    onClick={() =>
                      setSeries((value) =>
                        value.map((item, itemIndex) =>
                          itemIndex === seriesIndex
                            ? {
                                ...item,
                                labels: [
                                  ...item.labels,
                                  scatterChart ? String(item.labels.length) : "項目",
                                ],
                                pointIds: [...item.pointIds, draftId()],
                                values: [...item.values, 0],
                              }
                            : item,
                        ),
                      )
                    }
                    type="button"
                  >
                    項目を追加
                  </button>
                  <button
                    disabled={
                      !sourceState?.editable || saving || entry.labels.length <= 1
                    }
                    onClick={() =>
                      setSeries((value) =>
                        value.map((item, itemIndex) =>
                          itemIndex === seriesIndex
                            ? {
                                ...item,
                                labels: item.labels.slice(0, -1),
                                pointIds: item.pointIds.slice(0, -1),
                                values: item.values.slice(0, -1),
                              }
                            : item,
                        ),
                      )
                    }
                    type="button"
                  >
                    末尾を削除
                  </button>
                  <button
                    disabled={
                      !sourceState?.editable ||
                      saving ||
                      singleSeriesChart ||
                      series.length <= 1
                    }
                    onClick={() =>
                      setSeries((value) =>
                        value.filter((_, itemIndex) => itemIndex !== seriesIndex),
                      )
                    }
                    type="button"
                  >
                    系列を削除
                  </button>
                </div>
              </section>
            ))}
            {singleSeriesChart ? (
              <small className="studio-structured-hint">
                円グラフとドーナツグラフは1系列で編集します。
              </small>
            ) : (
              <button
                className="studio-add-series"
                disabled={!sourceState?.editable || saving}
                onClick={() =>
                  setSeries((value) => [
                    ...value,
                    {
                      draftId: draftId(),
                      name: `系列 ${value.length + 1}`,
                      labels: [scatterChart ? "0" : "項目"],
                      pointIds: [draftId()],
                      values: [0],
                    },
                  ])
                }
                type="button"
              >
                系列を追加
              </button>
            )}
            {comboScatterSeries ? (
              <small className="studio-structured-hint">
                複合グラフの散布図系列は保存できません。系列の種類を棒・折れ線・面へ変更してください。
              </small>
            ) : null}
            {scatterChart ? (
              <small className="studio-structured-hint">
                散布図の項目にはX座標となる数値を入力してください。
              </small>
            ) : series.length > 1 && !singleSeriesChart ? (
              <small className="studio-structured-hint">
                複数系列の項目名は、同じ順序・内容に揃えてください。
              </small>
            ) : null}
          </div>
        </>
      )}
      {message ? (
        <p className="studio-source-message" role="status">
          {message}
        </p>
      ) : null}
      <button
        className="studio-source-save"
        disabled={!sourceState?.editable || saving}
        onClick={() => void save()}
        type="button"
      >
        {saving ? "保存中…" : "データを保存"}
      </button>
    </details>
  );
}
