// TESTING (2026-07): Unit tests for makeColorer (tests/unit/colors.test.ts).
// Covers the classic-palette, fixed-color, value-mapping, and by-value
// gradient branches, plus the fallback when fields are missing.
import { classicColors, FieldColorModeId, MappingType } from '@grafana/data';

import { makeColorer } from '../../src/colors';
import { buildFrame } from './helpers';

const names = new Map([[0, 'A'], [1, 'B'], [2, 'C']]);

function fields() {
  const frame = buildFrame([['A', 'B', 2], ['B', 'C', 4]]);
  const [sourceField, targetField, valueField] = frame.fields;
  return { sourceField, targetField, valueField };
}

const group = (index: number, value = 1) => ({ index, startAngle: 0, endAngle: 1, value });

const chord = {
  source: { index: 0, startAngle: 0, endAngle: 1, value: 2, subindex: 1 },
  target: { index: 1, startAngle: 0, endAngle: 1, value: 2, subindex: 0 },
};

describe('makeColorer', () => {
  it('assigns classic palette colors by matrix index for groups', () => {
    const color = makeColorer(true, names, fields());
    expect(color(group(0))).toBe(classicColors[0]);
    expect(color(group(1))).toBe(classicColors[1]);
  });

  it('colors a chord by its source when colorBySource is true, target otherwise', () => {
    expect(makeColorer(true, names, fields())(chord)).toBe(classicColors[0]);
    expect(makeColorer(false, names, fields())(chord)).toBe(classicColors[1]);
  });

  it('wraps around the palette when there are more names than colors', () => {
    const color = makeColorer(true, names, fields());
    const idx = classicColors.length + 1;
    expect(color(group(idx))).toBe(classicColors[1]);
  });

  it('falls back to the palette when the driving field is missing', () => {
    const color = makeColorer(true, names, { valueField: fields().valueField });
    expect(color(group(2))).toBe(classicColors[2]);
  });

  it('uses the display processor of the driving field in fixed color mode', () => {
    const f = fields();
    f.sourceField.config = { color: { mode: FieldColorModeId.Fixed, fixedColor: 'red' }, mappings: [] };
    f.sourceField.display = () => ({ text: '', numeric: 0, color: '#ff0000' });
    const color = makeColorer(true, names, f);
    expect(color(group(0))).toBe('#ff0000');
  });

  it('honors value mappings in classic palette mode', () => {
    const f = fields();
    f.sourceField.config = {
      color: { mode: FieldColorModeId.PaletteClassic },
      mappings: [{ type: MappingType.ValueToText, options: { A: { color: '#123456', index: 0 } } }],
    };
    f.sourceField.display = (v) => ({ text: String(v), numeric: NaN, color: v === 'A' ? '#123456' : undefined });
    const color = makeColorer(true, names, f);
    // 'A' has a mapping override; 'B' does not and keeps the palette color.
    expect(color(group(0))).toBe('#123456');
    expect(color(group(1))).toBe(classicColors[1]);
  });

  it('colors by the value via the value field in gradient (by-value) modes', () => {
    const f = fields();
    f.sourceField.config = { color: { mode: FieldColorModeId.ContinuousGrYlRd }, mappings: [] };
    f.valueField.display = (v) => ({ text: String(v), numeric: Number(v), color: Number(v) > 3 ? '#00ff00' : '#0000ff' });
    const color = makeColorer(true, names, f);
    expect(color(group(0, 5))).toBe('#00ff00');
    expect(color(group(1, 2))).toBe('#0000ff');
  });
});
