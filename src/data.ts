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
//
// FEATURE (2026-07-07): Value Mapping support for node labels. prepData now
// also returns `displayNames` (matrix index -> mapped/formatted label),
// computed by running each raw node value through its source/target field's
// Grafana display processor via displayNameOf(). Node identity/aggregation is
// unchanged (still keyed on the raw value in `names`), so colors.ts's
// mapping/color lookups keep working; only the user-facing labels in chord.ts
// switch to `displayNames`. See displayNameOf() and the first pass below.
import { DataFrame, Field, getFieldDisplayName } from '@grafana/data';

export interface PrepSuccess {
  ok: true;
  /** matrix[sourceIdx][targetIdx] = aggregated value (d3.chordDirected reads
   *  matrix[i][j] as the flow from node i to node j) */
  matrix: number[][];
  /** matrix index -> raw node name (node identity; drives matrix indexing
   *  and value-mapping/color lookup in colors.ts) */
  names: Map<number, string>;
  /** matrix index -> display node name (the raw value run through the
   *  source/target field's display processor, so value mappings relabel the
   *  arc labels and tooltip labels). Falls back to the raw name. */
  displayNames: Map<number, string>;
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
 * Resolve the user-facing label for a raw node value by running it through the
 * field's Grafana display processor (which applies value mappings, and any
 * unit/decimal formatting). Falls back to the raw string when the field has no
 * display processor. The raw value is passed through unchanged so numeric value
 * mappings match on the original value, not its stringified form.
 */
function displayNameOf(field: Field, raw: unknown): string {
  return field.display?.(raw)?.text ?? String(raw);
}

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

  // First pass: collect the distinct nodes in row order. Node identity is the
  // raw stringified value (so a source "A" and a target "A" are the same node);
  // the display name is derived from the field the node was first seen on, so
  // value mappings on the source or target field relabel it.
  const index = new Map<string, number>();
  const names = new Map<number, string>();
  const displayNames = new Map<number, string>();
  const addNode = (raw: unknown, field: Field) => {
    const key = String(raw);
    if (!index.has(key)) {
      const idx = index.size;
      index.set(key, idx);
      names.set(idx, key);
      displayNames.set(idx, displayNameOf(field, raw));
    }
  };
  for (let i = 0; i < rowCount; i++) {
    const s = sourceField.values[i];
    const t = targetField.values[i];
    if (s === null || s === undefined || t === null || t === undefined) {
      return fail('Source or target values are missing in the data');
    }
    addNode(s, sourceField);
    addNode(t, targetField);
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

  return { ok: true, matrix, names, displayNames, sourceField, targetField, valueField };
}
