// TESTING (2026-07): Unit tests for the d3 rendering module
// (tests/unit/chord.test.ts). Covers end-to-end DOM output into a real
// (jsdom) SVG element, the size guard clauses, and - most importantly - that
// pointer events invoke the Grafana tooltip callback with the right payload
// (this replaced the old native <title> tooltips). Tooltip labels are
// asserted in DATA direction (source → target): a row LBL,ANL must read
// "LBL → ANL".
import { classicColors, createTheme } from '@grafana/data';

import { createViz, ChordVizOptions, ChordTooltipData } from '../../src/chord';
import { prepData } from '../../src/data';
import { buildFrame, buildSvg, DEFAULT_ROWS, Row } from './helpers';

function prepFor(rows: Row[] = DEFAULT_ROWS) {
  const result = prepData(buildFrame(rows), 'source', 'target', 'value');
  if (!result.ok) {
    throw new Error(`test data failed to prepare: ${result.reason}`);
  }
  return result;
}

function vizOptions(overrides: Partial<ChordVizOptions> = {}): ChordVizOptions {
  return {
    prep: prepFor(),
    width: 400,
    height: 400, // radius 200, comfortably above the 180 minimum
    txtLen: 100,
    labelSize: 12,
    colorBySource: true,
    pointLength: 10,
    theme: createTheme(),
    onTooltip: jest.fn(),
    ...overrides,
  };
}

describe('createViz', () => {
  it('renders ribbons, arcs, and labels into the svg', () => {
    const svg = buildSvg();
    createViz(svg, vizOptions());

    // 3 data rows -> 3 chord ribbons in the first group
    const ribbons = svg.querySelectorAll(':scope > g:first-of-type path');
    expect(ribbons.length).toBe(3);
    // 3 distinct names -> 3 outer arcs + 3 labels + 3 tick lines
    const arcs = svg.querySelectorAll(':scope > g:nth-of-type(2) > g > path');
    expect(arcs.length).toBe(3);
    expect(svg.querySelectorAll('text').length).toBe(3);
    const labels = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent);
    expect(labels).toEqual(expect.arrayContaining(['LBL', 'ANL', 'CERN']));
    // ribbons are filled with palette colors
    expect(classicColors).toContain(ribbons[0].getAttribute('fill'));
  });

  it('does not use native <title> tooltips anymore', () => {
    const svg = buildSvg();
    createViz(svg, vizOptions());
    // REFACTOR GUARD: the old implementation appended <title> elements;
    // hover content must now flow through the Grafana tooltip callback.
    expect(svg.querySelectorAll('title').length).toBe(0);
  });

  it('reports chord tooltips in data direction and clears them on pointerout', () => {
    const svg = buildSvg();
    const onTooltip = jest.fn();
    createViz(svg, vizOptions({ onTooltip }));

    const ribbons = svg.querySelectorAll(':scope > g:first-of-type path');
    const seen: string[] = [];
    ribbons.forEach((ribbon, i) => {
      ribbon.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 42, clientY: 24 }));
      const payload: ChordTooltipData = onTooltip.mock.calls[i][0];
      seen.push(payload.label);
      expect(payload).toEqual(expect.objectContaining({ value: expect.any(String), x: 42, y: 24 }));
    });
    // The labels must follow the DATA rows (source → target), not the
    // transposed orientation the pre-fix matrix produced.
    expect(seen.sort()).toEqual(['ANL → CERN', 'LBL → ANL', 'LBL → CERN']);

    ribbons[0].dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
    expect(onTooltip).toHaveBeenLastCalledWith(null);
  });

  it('reports node totals (incoming + outgoing) on outer arc hover', () => {
    const svg = buildSvg();
    const onTooltip = jest.fn();
    createViz(svg, vizOptions({ onTooltip }));

    // Hover every arc and collect the reported labels/values.
    const arcs = svg.querySelectorAll(':scope > g:nth-of-type(2) > g > path');
    const reported = new Map<string, string>();
    arcs.forEach((arc) => {
      arc.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 5, clientY: 6 }));
      const payload: ChordTooltipData = onTooltip.mock.calls[onTooltip.mock.calls.length - 1][0];
      reported.set(payload.label, payload.value);
    });
    // d3.chordDirected group values combine in + out flow through the node:
    // LBL 13 out + 0 in; ANL 5 out + 10 in; CERN 0 out + 8 in.
    expect(reported.get('LBL (total)')).toBe('13');
    expect(reported.get('ANL (total)')).toBe('15');
    expect(reported.get('CERN (total)')).toBe('8');
  });

  it('omits the unit suffix (no literal "undefined") when the value field has no unit', () => {
    // The value field carries no display processor / unit, so the display
    // result has an undefined suffix. The tooltip must not print "undefined".
    const svg = buildSvg();
    const onTooltip = jest.fn();
    createViz(svg, vizOptions({ onTooltip }));

    const arcs = svg.querySelectorAll(':scope > g:nth-of-type(2) > g > path');
    arcs.forEach((arc) => {
      arc.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 5, clientY: 6 }));
    });
    const values = onTooltip.mock.calls.map((c) => (c[0] as ChordTooltipData | null)?.value).filter(Boolean);
    expect(values.length).toBeGreaterThan(0);
    values.forEach((v) => expect(v).not.toContain('undefined'));
  });

  it('appends the unit suffix to tooltip values when the value field has a unit', () => {
    const svg = buildSvg();
    const onTooltip = jest.fn();
    const prep = prepFor();
    // Simulate a configured unit: Grafana attaches a display processor whose
    // result carries the unit as a suffix.
    prep.valueField.display = (v) => ({ text: String(v), numeric: Number(v), suffix: 'bps' });
    createViz(svg, vizOptions({ prep, onTooltip }));

    const arcs = svg.querySelectorAll(':scope > g:nth-of-type(2) > g > path');
    arcs[0].dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 5, clientY: 6 }));
    const payload: ChordTooltipData = onTooltip.mock.calls[onTooltip.mock.calls.length - 1][0];
    expect(payload.value).toMatch(/\bbps$/);
  });

  it('shows value-mapped display names in arc labels and tooltip labels', () => {
    const svg = buildSvg();
    const onTooltip = jest.fn();
    // Map raw endpoint names to friendly labels via the field display
    // processors (how Grafana surfaces value mappings to the panel). The
    // display processors must be attached before prepData runs, since that is
    // where display names are resolved — matching Grafana's real order.
    const frame = buildFrame([['LBL', 'ANL', 10]]);
    const rename: Record<string, string> = { LBL: 'Berkeley', ANL: 'Argonne' };
    const mapper = (v: unknown) => ({ text: rename[String(v)] ?? String(v), numeric: NaN });
    frame.fields[0].display = mapper; // source
    frame.fields[1].display = mapper; // target
    const prep = prepData(frame, 'source', 'target', 'value');
    if (!prep.ok) {
      throw new Error(prep.reason);
    }
    createViz(svg, vizOptions({ prep, onTooltip }));

    // Arc labels use the mapped names.
    const labels = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Berkeley', 'Argonne']));
    expect(labels).not.toEqual(expect.arrayContaining(['LBL', 'ANL']));

    // Chord tooltip label uses the mapped names too.
    const ribbon = svg.querySelector(':scope > g:first-of-type path')!;
    ribbon.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 1, clientY: 2 }));
    const payload: ChordTooltipData = onTooltip.mock.calls[onTooltip.mock.calls.length - 1][0];
    expect(payload.label).toBe('Berkeley → Argonne');
  });

  it('renders nothing when the panel is too small (radius < 180)', () => {
    const svg = buildSvg();
    createViz(svg, vizOptions({ height: 200 }));
    expect(svg.children.length).toBe(0);
  });

  it('sizes by the SHORTER dimension: a narrow-but-tall panel also blanks', () => {
    const svg = buildSvg();
    createViz(svg, vizOptions({ width: 200, height: 600 }));
    expect(svg.children.length).toBe(0);
  });

  it('renders nothing when the Text Length leaves no room for chords', () => {
    const svg = buildSvg();
    // radius 200 minus (200 + margins) would drive the inner radius negative
    createViz(svg, vizOptions({ txtLen: 200 }));
    expect(svg.children.length).toBe(0);
  });

  it('clears previous contents before re-rendering', () => {
    const svg = buildSvg();
    createViz(svg, vizOptions());
    const firstCount = svg.querySelectorAll('path').length;
    createViz(svg, vizOptions());
    expect(svg.querySelectorAll('path').length).toBe(firstCount);
  });
});
