// TESTING (2026-07): Unit tests for prepData (tests/unit/data.test.ts).
// Covers adjacency-matrix construction and orientation, aggregation of
// duplicate pairs, column guessing, display-name field resolution, and each
// failure reason of the discriminated PrepResult.
import { FieldType, toDataFrame } from '@grafana/data';

import { prepData } from '../../src/data';
import { buildFrame } from './helpers';

describe('prepData', () => {
  it('builds an adjacency matrix oriented matrix[source][target]', () => {
    const result = prepData(buildFrame([['A', 'B', 2], ['B', 'C', 4]]), 'source', 'target', 'value');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Names discovered in row order: A, B, C
    expect(result.names.get(0)).toBe('A');
    expect(result.names.get(1)).toBe('B');
    expect(result.names.get(2)).toBe('C');
    // d3.chordDirected reads matrix[i][j] as flow FROM i TO j, so a data row
    // A -> B must land in matrix[A][B].
    expect(result.matrix[0][1]).toBe(2); // A -> B
    expect(result.matrix[1][2]).toBe(4); // B -> C
    expect(result.matrix[1][0]).toBe(0); // no reverse flow
  });

  it('aggregates repeated source/target pairs', () => {
    const result = prepData(buildFrame([['A', 'B', 2], ['A', 'B', 3]]), 'source', 'target', 'value');
    expect(result.ok && result.matrix[0][1]).toBe(5);
  });

  it('guesses the first three columns when no field names are given', () => {
    const result = prepData(buildFrame([['A', 'B', 7]]), undefined, undefined, undefined);
    expect(result.ok && result.names.get(0)).toBe('A');
    expect(result.ok && result.matrix[0][1]).toBe(7);
  });

  it('resolves fields configured by display name (e.g. displayName overrides)', () => {
    const frame = buildFrame([['A', 'B', 7]]);
    frame.fields[2].config.displayName = 'Throughput';
    const result = prepData(frame, 'source', 'target', 'Throughput');
    expect(result.ok && result.matrix[0][1]).toBe(7);
  });

  it('relabels node names via the source/target field display processor (value mappings)', () => {
    const frame = buildFrame([['1', '2', 5]]);
    const [sourceField, targetField] = frame.fields;
    // A value mapping is surfaced to the panel as a field display processor.
    sourceField.display = (v) => ({ text: v === '1' ? 'Server A' : String(v), numeric: NaN });
    targetField.display = (v) => ({ text: v === '2' ? 'Server B' : String(v), numeric: NaN });

    const result = prepData(frame, 'source', 'target', 'value');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Identity/raw names are preserved (colors.ts and the matrix key on these).
    expect(result.names.get(0)).toBe('1');
    expect(result.names.get(1)).toBe('2');
    // Display names carry the mapped text from the field each node was first
    // seen on (source for node 0, target for node 1).
    expect(result.displayNames.get(0)).toBe('Server A');
    expect(result.displayNames.get(1)).toBe('Server B');
  });

  it('falls back to the raw name for display when the field has no display processor', () => {
    const result = prepData(buildFrame([['A', 'B', 1]]), 'source', 'target', 'value');
    expect(result.ok && result.displayNames.get(0)).toBe('A');
    expect(result.ok && result.displayNames.get(1)).toBe('B');
  });

  it('returns the resolved fields on success', () => {
    const result = prepData(buildFrame(), 'source', 'target', 'value');
    expect(result.ok && result.sourceField.name).toBe('source');
    expect(result.ok && result.valueField.name).toBe('value');
  });

  it('fails with a reason when a configured field does not exist', () => {
    const result = prepData(buildFrame(), 'nope', 'target', 'value');
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('"nope" not found') });
  });

  it('fails with a reason when the value field does not exist', () => {
    const result = prepData(buildFrame(), 'source', 'target', 'missing');
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('Value field "missing" not found') });
  });

  it('fails with a reason when the value field is not numeric', () => {
    const result = prepData(buildFrame([['A', 'B', 'not-a-number']]), 'source', 'target', 'value');
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('non-numeric') });
  });

  it('fails with a reason when there is no frame', () => {
    expect(prepData(undefined, 'source', 'target', 'value')).toEqual({ ok: false, reason: 'No data' });
  });

  it('fails with a reason when the query returned no rows', () => {
    const result = prepData(buildFrame([]), 'source', 'target', 'value');
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('no rows') });
  });

  it('fails with a reason when source or target values are null', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'source', type: FieldType.string, values: ['A', null] },
        { name: 'target', type: FieldType.string, values: ['B', 'C'] },
        { name: 'value', type: FieldType.number, values: [1, 2] },
      ],
    });
    const result = prepData(frame, 'source', 'target', 'value');
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('missing') });
  });
});
