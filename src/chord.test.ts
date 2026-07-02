// TESTING (2026-07): Unit tests for the d3 rendering module.
// Covers:
//  - prepData: adjacency-matrix construction, aggregation of duplicate
//    source/target pairs, column guessing, and the bad-data bail-out.
//  - makeColorer: classic-palette color-by-index behavior for chords,
//    subgroups, and groups.
//  - createViz: end-to-end DOM output into a real (jsdom) SVG element,
//    the too-small / no-data guard clauses, and - most importantly - that
//    pointer events invoke the Grafana tooltip callback with the right
//    payload (this replaced the old native <title> tooltips).
import { classicColors, createTheme, DataFrameView, FieldColorModeId, FieldType, LoadingState, PanelData, toDataFrame, getDefaultTimeRange } from '@grafana/data';

import { createViz, makeColorer, prepData, ChordVizOptions, ChordTooltipData } from './chord';

/** Build a source/target/value data frame like a Grafana query would produce. */
function buildFrame(rows: Array<[string, string, number]>) {
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

function buildPanelData(frame = buildFrame([['LBL', 'ANL', 10], ['ANL', 'CERN', 5], ['LBL', 'CERN', 3]])): PanelData {
  return { series: [frame], state: LoadingState.Done, timeRange: getDefaultTimeRange() };
}

function buildSvg(): SVGSVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}

function vizOptions(overrides: Partial<ChordVizOptions> = {}): ChordVizOptions {
  return {
    data: buildPanelData(),
    height: 400, // radius 200, comfortably above the 180 minimum
    src: 'source',
    target: 'target',
    val: 'value',
    txtLen: 100,
    labelSize: 12,
    colorBySource: true,
    pointLength: 10,
    theme: createTheme(),
    onTooltip: jest.fn(),
    ...overrides,
  };
}

describe('prepData', () => {
  it('builds an adjacency matrix keyed by name index', () => {
    const view = new DataFrameView(buildFrame([['A', 'B', 2], ['B', 'C', 4]]));
    const [matrix, revIdx] = prepData(view, 'source', 'target', 'value');

    expect(matrix).not.toBeNull();
    expect(revIdx).not.toBeNull();
    // Names discovered in row order: A, B, C
    expect(revIdx!.get(0)).toBe('A');
    expect(revIdx!.get(1)).toBe('B');
    expect(revIdx!.get(2)).toBe('C');
    // matrix[targetIdx][sourceIdx] === value
    expect(matrix![1][0]).toBe(2); // A -> B
    expect(matrix![2][1]).toBe(4); // B -> C
  });

  it('aggregates repeated source/target pairs', () => {
    const view = new DataFrameView(buildFrame([['A', 'B', 2], ['A', 'B', 3]]));
    const [matrix] = prepData(view, 'source', 'target', 'value');
    expect(matrix![1][0]).toBe(5);
  });

  it('guesses the first three columns when no field names are given', () => {
    const view = new DataFrameView(buildFrame([['A', 'B', 7]]));
    const [matrix, revIdx] = prepData(view, undefined, undefined, undefined);
    expect(revIdx!.get(0)).toBe('A');
    expect(matrix![1][0]).toBe(7);
  });

  it('returns nulls when the configured fields do not exist in the data', () => {
    const view = new DataFrameView(buildFrame([['A', 'B', 7]]));
    const [matrix, revIdx] = prepData(view, 'nope', 'missing', 'value');
    expect(matrix).toBeNull();
    expect(revIdx).toBeNull();
  });
});

describe('makeColorer', () => {
  const frame = buildFrame([['A', 'B', 2], ['B', 'C', 4]]);
  const revIdx = new Map([[0, 'A'], [1, 'B'], [2, 'C']]);

  it('assigns classic palette colors by matrix index for groups', () => {
    const color = makeColorer(true, revIdx, frame, 'source', 'target', 'value');
    expect(color({ index: 0, startAngle: 0, endAngle: 1, value: 2 })).toBe(classicColors[0]);
    expect(color({ index: 1, startAngle: 0, endAngle: 1, value: 4 })).toBe(classicColors[1]);
  });

  it('colors a chord by its source when colorBySource is true, target otherwise', () => {
    const chord = {
      source: { index: 0, startAngle: 0, endAngle: 1, value: 2, subindex: 1 },
      target: { index: 1, startAngle: 0, endAngle: 1, value: 2, subindex: 0 },
    };
    const bySource = makeColorer(true, revIdx, frame, 'source', 'target', 'value');
    const byTarget = makeColorer(false, revIdx, frame, 'source', 'target', 'value');
    expect(bySource(chord)).toBe(classicColors[0]);
    expect(byTarget(chord)).toBe(classicColors[1]);
  });

  it('wraps around the palette when there are more names than colors', () => {
    const color = makeColorer(true, revIdx, frame, 'source', 'target', 'value');
    const idx = classicColors.length + 1;
    expect(color({ index: idx, startAngle: 0, endAngle: 1, value: 1 })).toBe(classicColors[1]);
  });
});

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

  it('invokes the tooltip callback on chord hover and clears it on pointerout', () => {
    const svg = buildSvg();
    const onTooltip = jest.fn();
    createViz(svg, vizOptions({ onTooltip }));

    const ribbon = svg.querySelector(':scope > g:first-of-type path')!;
    ribbon.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 42, clientY: 24 }));

    expect(onTooltip).toHaveBeenCalledWith(
      expect.objectContaining({
        label: expect.stringContaining('→'),
        value: expect.any(String),
        x: 42,
        y: 24,
      })
    );
    const payload: ChordTooltipData = onTooltip.mock.calls[0][0];
    // NOTE: prepData fills matrix[target][source] (legacy orientation), so a
    // chord's d3 "source" is the data's target column. The original <title>
    // tooltips had the same orientation; preserved verbatim by the refactor.
    expect(['ANL → LBL', 'CERN → ANL', 'CERN → LBL']).toContain(payload.label);

    ribbon.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
    expect(onTooltip).toHaveBeenLastCalledWith(null);
  });

  it('invokes the tooltip callback with totals on outer arc hover', () => {
    const svg = buildSvg();
    const onTooltip = jest.fn();
    createViz(svg, vizOptions({ onTooltip }));

    const arc = svg.querySelector(':scope > g:nth-of-type(2) > g > path')!;
    arc.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 5, clientY: 6 }));

    expect(onTooltip).toHaveBeenCalledWith(
      expect.objectContaining({ label: expect.stringContaining('(total)'), x: 5, y: 6 })
    );
  });

  it('renders nothing when the panel is too small (radius < 180)', () => {
    const svg = buildSvg();
    createViz(svg, vizOptions({ height: 200 }));
    expect(svg.children.length).toBe(0);
  });

  it('renders nothing when there is no data', () => {
    const svg = buildSvg();
    createViz(svg, vizOptions({ data: { ...buildPanelData(), series: [] } }));
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
