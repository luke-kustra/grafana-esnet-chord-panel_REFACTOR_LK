// TESTING (2026-07): Shared builders for the unit test suites.
import { FieldColorModeId, FieldType, LoadingState, PanelData, getDefaultTimeRange, toDataFrame } from '@grafana/data';

export type Row = [string, string, number | string];

export const DEFAULT_ROWS: Row[] = [
  ['LBL', 'ANL', 10],
  ['ANL', 'CERN', 5],
  ['LBL', 'CERN', 3],
];

/** Build a source/target/value data frame like a Grafana query would produce. */
export function buildFrame(rows: Row[] = DEFAULT_ROWS) {
  const frame = toDataFrame({
    fields: [
      { name: 'source', type: FieldType.string, values: rows.map((r) => r[0]) },
      { name: 'target', type: FieldType.string, values: rows.map((r) => r[1]) },
      { name: 'value', type: FieldType.number, values: rows.map((r) => r[2]) },
    ],
  });
  // Panel data normally arrives with field config applied; the colorer
  // reads the color mode and mappings from it.
  for (const field of frame.fields) {
    field.config = { color: { mode: FieldColorModeId.PaletteClassic }, mappings: [] };
  }
  return frame;
}

export function buildPanelData(frame = buildFrame()): PanelData {
  return { series: [frame], state: LoadingState.Done, timeRange: getDefaultTimeRange() };
}

export function buildSvg(): SVGSVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}
