// REFACTOR (2026-07-02): Data preparation was extracted from chord.ts into
// its own module. Structural changes:
//  - prepData no longer goes through DataFrameView. It resolves the three
//    Field objects once up front and iterates their value arrays directly,
//    instead of calling Object.keys() on a row proxy for every row.
//  - The `[null, null]` failure tuple was replaced with a discriminated
//    union (PrepResult). Callers can now distinguish *why* preparation
//    failed and surface the reason to the user instead of logging to the
//    console and rendering a blank panel.
//  - The success value carries the resolved Field objects, so downstream
//    code (color resolution, value formatting) no longer re-scans
//    frame.fields by name.
import { DataFrame, Field, getFieldDisplayName } from '@grafana/data';

export interface PrepSuccess {
  ok: true;
  /** matrix[sourceIdx][targetIdx] = aggregated value (d3.chordDirected reads
   *  matrix[i][j] as the flow from node i to node j) */
  matrix: number[][];
  /** matrix index -> node name */
  names: Map<number, string>;
  sourceField: Field;
  targetField: Field;
  valueField: Field;
}

export interface PrepFailure {
  ok: false;
  /** Human-readable explanation, rendered in the panel. */
  reason: string;
}

export type PrepResult = PrepSuccess | PrepFailure;

const fail = (reason: string): PrepFailure => ({ ok: false, reason });

/**
 * Resolve a configured field name against a frame. The option editors list
 * *display* names (which reflect displayName overrides and labels), so match
 * on those as well as the raw field name. With no name configured, fall back
 * to the field at `fallbackIndex` (the legacy "guess the first three
 * columns" behavior).
 */
function findField(frame: DataFrame, name: string | undefined, fallbackIndex: number): Field | undefined {
  if (name === undefined || name === '') {
    return frame.fields[fallbackIndex];
  }
  return frame.fields.find((f) => f.name === name || getFieldDisplayName(f, frame) === name);
}

/**
 * Build the adjacency matrix consumed by d3.chordDirected, plus a reverse
 * lookup from matrix index to node name. Repeated source/target pairs are
 * aggregated by summing their values.
 *
 * @param frame The (first) data frame of the panel data
 * @param src Field to use as the source; defaults to the first column
 * @param target Field to use as the target; defaults to the second column
 * @param val Numeric field to aggregate; defaults to the third column
 */
export function prepData(frame: DataFrame | undefined, src?: string, target?: string, val?: string): PrepResult {
  if (!frame || frame.fields.length === 0) {
    return fail('No data');
  }

  const sourceField = findField(frame, src, 0);
  const targetField = findField(frame, target, 1);
  const valueField = findField(frame, val, 2);

  if (!sourceField) {
    return fail(`Source field "${src}" not found in the query result`);
  }
  if (!targetField) {
    return fail(`Target field "${target}" not found in the query result`);
  }
  if (!valueField) {
    return fail(`Value field "${val}" not found in the query result`);
  }

  const rowCount = frame.length;
  if (rowCount === 0) {
    return fail('Query returned no rows');
  }

  // First pass: collect the distinct node names in row order.
  const index = new Map<string, number>();
  const names = new Map<number, string>();
  for (let i = 0; i < rowCount; i++) {
    const s = sourceField.values[i];
    const t = targetField.values[i];
    if (s === null || s === undefined || t === null || t === undefined) {
      return fail('Source or target values are missing in the data');
    }
    for (const name of [String(s), String(t)]) {
      if (!index.has(name)) {
        names.set(index.size, name);
        index.set(name, index.size);
      }
    }
  }

  // Second pass: aggregate values into the matrix.
  const matrix: number[][] = Array.from(index, () => new Array<number>(index.size).fill(0));
  for (let i = 0; i < rowCount; i++) {
    const v = Number(valueField.values[i]);
    if (Number.isNaN(v)) {
      return fail(`Value field "${valueField.name}" contains non-numeric data`);
    }
    const s = index.get(String(sourceField.values[i]))!;
    const t = index.get(String(targetField.values[i]))!;
    matrix[s][t] += v;
  }

  return { ok: true, matrix, names, sourceField, targetField, valueField };
}
