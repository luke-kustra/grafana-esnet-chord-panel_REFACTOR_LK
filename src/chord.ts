// REFACTOR (2026-07): This module was previously chord.js (plain JavaScript
// with a hand-written chord.d.ts stub). Summary of changes:
//  - Converted to TypeScript; the chord.d.ts stub was deleted.
//  - d3 is now imported from the npm `d3` package instead of a 274 KB
//    minified copy vendored into src/ (d3.min.js / d3-color.v1.min.js).
//  - TOOLTIP CHANGE: the native SVG `<title>` elements (browser-default
//    tooltips) were removed. Chords and arcs now emit pointer events through
//    an `onTooltip` callback, and ChordPanel.tsx renders the hover content in
//    Grafana's own tooltip component so it matches the Grafana theme.
//  - The React hooks (useTheme2/useD3) that used to live at the bottom of
//    this file were moved into ChordPanel.tsx. Calling hooks from a plain
//    function that was itself called conditionally violated React's rules of
//    hooks; this module is now pure rendering logic with no React imports.
//  - The value display processor is now looked up by the user-selected value
//    field instead of the previously hard-coded column index 2 (this resolves
//    an old `TODO` in the original source).
//  - createViz's long positional parameter list was replaced with a single
//    typed options object.
import * as d3 from 'd3';
import {
  classicColors,
  DataFrame,
  DataFrameView,
  DisplayProcessor,
  Field,
  FieldColorModeId,
  GrafanaTheme2,
  PanelData,
} from '@grafana/data';

/** Hover payload handed to the React layer for Grafana tooltip rendering. */
export interface ChordTooltipData {
  /** e.g. "src → dst" for a chord, or "name (total)" for an outer arc */
  label: string;
  /** formatted value including unit suffix */
  value: string;
  /** viewport coordinates of the pointer, for tooltip positioning */
  x: number;
  y: number;
}

/** Called with hover data on pointer move, and with null on pointer out. */
export type TooltipCallback = (tooltip: ChordTooltipData | null) => void;

export interface ChordVizOptions {
  data: PanelData;
  height: number;
  src?: string;
  target?: string;
  val?: string;
  txtLen: number;
  labelSize: number;
  colorBySource: boolean;
  pointLength: number;
  theme: GrafanaTheme2;
  onTooltip: TooltipCallback;
}

type ChordDatum = d3.Chord | d3.ChordGroup | d3.ChordSubgroup;

/**
 * Create the chord diagram using d3.
 * @param elem The parent svg element that will house this diagram
 * @param options All rendering inputs (data, sizing, field names, theme, and
 *   the tooltip callback) as a single typed object.
 */
export function createViz(elem: SVGSVGElement | null, options: ChordVizOptions): void {
  const { data, height, src, target, val, txtLen, labelSize, colorBySource, pointLength, theme, onTooltip } = options;

  // do a bit of work to setup the visual layout of the widget --------
  if (elem === null) {
    console.log('bailing after failing to find parent element');
    return;
  }
  while (elem.firstChild) {
    // clear out old contents
    elem.removeChild(elem.lastChild!);
  }

  const svg = d3.select(elem);

  svg.attr('viewBox', `${-height / 2}, ${-height / 2}, ${height}, ${height}`);

  const diameter = height;
  const radius = diameter / 2;

  if (radius < 180) {
    // too small to do anything useful
    console.log('too small to render');
    return;
  }
  // leave room for labels on outside
  const innerRadius = radius - (txtLen + 4 + 12);
  // sets size of outer band
  const outerRadius = innerRadius + 12;

  const frame = data.series[0];

  if (frame === null || frame === undefined) {
    // no data, bail
    console.log('no data , no dice');
    return;
  }

  const view = new DataFrameView(frame);
  const [matrix, nameRevIdx] = prepData(view, src, target, val);

  if (matrix === null || nameRevIdx === null) {
    return;
  }

  // REFACTOR (2026-07): The display processor used to be hard-coded to
  // column 2 ("questionable assumption" per the original comment/TODO). It is
  // now resolved from the value field the user actually selected, falling
  // back to column 2 only when no match is found.
  let valueFieldIndex = frame.fields.findIndex((f) => f.name === val);
  if (valueFieldIndex === -1) {
    valueFieldIndex = 2;
  }
  // getFieldDisplayProcessor can return undefined in modern @grafana/data,
  // so fall back to a plain text formatter.
  const fieldDisplay: DisplayProcessor =
    view.getFieldDisplayProcessor(valueFieldIndex) ?? ((value: unknown) => ({ text: String(value), numeric: Number(value) }));

  const arc = d3.arc<d3.ChordGroup>().innerRadius(innerRadius).outerRadius(outerRadius);

  const ribbon = d3
    .ribbonArrow()
    .radius(innerRadius - 2)
    .padAngle(2 / innerRadius)
    .headRadius(innerRadius * (pointLength / 100.0));

  const chordLayout = d3
    .chordDirected()
    .padAngle(12 / innerRadius)
    .sortSubgroups(d3.descending)
    .sortChords(d3.descending);

  const chords = chordLayout(matrix);

  // build ordinal color scale keyed on index used in the matrix
  const color = makeColorer(colorBySource, nameRevIdx, frame, src, target, val);

  // Darken helper; d3.color() can return null so guard before calling darker.
  const darker = (d: ChordDatum) => d3.color(color(d))?.darker()?.toString() ?? null;

  // REFACTOR (2026-07): Tooltip helpers. These replace the old
  // `.append('title')` calls: instead of relying on the browser-native
  // tooltip, hover data is forwarded to React via onTooltip so it can be
  // rendered with Grafana's themed tooltip.
  const chordTooltip = (event: PointerEvent, d: d3.Chord) => {
    const from = nameRevIdx.get(d.source.index);
    const to = nameRevIdx.get(d.target.index);
    const disp = fieldDisplay(d.source.value);
    onTooltip({
      label: `${from} → ${to}`,
      value: `${disp.text}${disp.suffix ? ` ${disp.suffix}` : ''}`,
      x: event.clientX,
      y: event.clientY,
    });
  };
  const groupTooltip = (event: PointerEvent, d: d3.ChordGroup) => {
    const disp = fieldDisplay(d.value);
    onTooltip({
      label: `${nameRevIdx.get(d.index)} (total)`,
      value: `${disp.text}${disp.suffix ? ` ${disp.suffix}` : ''}`,
      x: event.clientX,
      y: event.clientY,
    });
  };
  const hideTooltip = () => onTooltip(null);

  // generate the inner chords
  svg
    .append('g')
    .attr('fill-opacity', 0.99)
    .selectAll('g')
    .data(chords)
    .join('path')
    .attr('d', ribbon as unknown as (d: d3.Chord) => string)
    .attr('fill', (d) => color(d))
    .attr('stroke', (d) => darker(d))
    .style('mix-blend-mode', 'normal')
    // REFACTOR (2026-07): was `.call((g) => g.append('title')...)` - now
    // feeds Grafana's tooltip instead of the native browser tooltip.
    .on('pointermove', chordTooltip)
    .on('pointerout', hideTooltip);

  // generate the outer bands and text
  svg
    .append('g')
    .attr('font-family', 'sans-serif')
    .attr('font-size', 10)
    .selectAll('g')
    .data(chords.groups)
    .join('g')
    .call((g) =>
      g
        .append('path')
        .attr('d', arc)
        .attr('fill', (d) => color(d))
        .attr('stroke', (d) => darker(d))
        // REFACTOR (2026-07): was `.append('title')` - see note above.
        .on('pointermove', groupTooltip)
        .on('pointerout', hideTooltip)
    )
    .call((g) =>
      g
        .append('g')
        .attr('transform', (d) => {
          const rot = (((d.startAngle + d.endAngle) / 2) * 180) / Math.PI - 90;
          const trans = outerRadius + txtLen / 2 + 4;
          return `rotate(${rot}) translate(${trans}, 0)`;
        })
        .attr('fill', theme.colors.text.primary)
        .attr('font-size', labelSize)
        .append('text')
        .attr('text-anchor', (d) => (d.startAngle < Math.PI ? 'start' : 'end'))
        .attr('transform', (d) => (d.startAngle >= Math.PI ? 'rotate(180)' : null))
        // dont show if the "pie" is too small
        .text((d) => (d.endAngle - d.startAngle > 0.025 ? nameRevIdx.get(d.index) ?? '' : '. . .'))
        .call(wrap, txtLen)
    )
    .call((g) =>
      g
        .append('line')
        .attr('transform', (d) => {
          const rot = (((d.startAngle + d.endAngle) / 2) * 180) / Math.PI - 90;
          return `rotate(${rot}) translate(${outerRadius},0)`;
        })
        .attr('stroke', (d) => darker(d))
        .attr('x2', 4)
    );
}

/**
 * Word-wrap the outer labels to fit within the reserved text length.
 * REFACTOR (2026-07): converted to typed d3 selections; logic unchanged.
 */
function wrap(text: d3.Selection<SVGTextElement, d3.ChordGroup, SVGGElement, unknown>, width: number) {
  text.each(function () {
    const textElem = d3.select(this);
    const words = (textElem.text() ?? '').split(/\s+/).reverse();
    let word: string | undefined;
    let line: string[] = [];
    const dy = 0.35;
    let tspan = textElem.text(null).append('tspan').attr('text-anchor', 'middle').attr('x', 0).attr('dy', dy + 'em');

    while ((word = words.pop())) {
      line.push(word);
      tspan.text(line.join(' '));
      if (tspan.node()!.getComputedTextLength() > width) {
        line.pop();
        tspan.text(line.join(' '));
        line = [word];
        tspan = textElem
          .append('tspan')
          .attr('text-anchor', 'middle')
          .attr('x', 0)
          .attr('dy', 0.9 + 'em')
          .text(word);
      }
    }
  });
}

/**
 * this function creates an adjacency matrix to be consumed by the chord
 * function returns the matrix + a reverse lookup Map to go from source and
 * target id to description assumes that data coming to us has at least 3
 * columns if no preferences provided, assumes the first 3 columns are source
 * and target dimensions then value to display
 * REFACTOR (2026-07): converted to TypeScript; the failure return value was
 * normalized to `[null, null]` (it used to be a 3-tuple even though the
 * success path returned a 2-tuple).
 * @param data Data for the chord diagram
 * @param src The data series that will act as the source
 * @param target The data series that will act as the target
 * @param val The data series that will act as the value
 */
// TESTING (2026-07): exported so unit tests can exercise the matrix
// aggregation logic directly (see chord.test.ts).
export function prepData(
  data: DataFrameView,
  src?: string,
  target?: string,
  val?: string
): [number[][], Map<number, string>] | [null, null] {
  // create array of names
  let sourceKey = src;
  let targetKey = target;
  let valKey = val;
  const names: Record<string, number> = {};

  let err = 0;
  data.forEach((row: Record<string, unknown>) => {
    const rowKey = Object.keys(row);
    if (sourceKey === undefined) {
      sourceKey = rowKey[0];
    }
    if (targetKey === undefined) {
      targetKey = rowKey[1];
    }
    if (valKey === undefined) {
      valKey = rowKey[2];
    }

    const sourceVal = row[sourceKey];
    const targetVal = row[targetKey];

    // either the provided keys or the guessed keys arent working
    if (sourceVal === null || sourceVal === undefined || targetVal === null || targetVal === undefined) {
      console.log('can not find the source or target in the data set, bailing');
      err = 1;
      return;
    }
    names[String(sourceVal)] = 1;
    names[String(targetVal)] = 1;
  });

  if (err) {
    // something is wonky with the data
    return [null, null];
  }

  // build matrix
  const nameArray = Object.keys(names);
  const index = new Map(nameArray.map((name, i) => [name, i]));
  const revIdx = new Map(nameArray.map((name, i) => [i, name]));
  const matrix: number[][] = Array.from(index, () => new Array(nameArray.length).fill(0));
  data.forEach((row: Record<string, unknown>) => {
    // The keys of the names object were coerced to strings. If any values here
    // are not strings, cast them to strings.
    const s = String(row[sourceKey!]);
    const t = String(row[targetKey!]);
    const v = Number(row[valKey!]);
    // aggregate data
    matrix[index.get(t)!][index.get(s)!] += v;
  });
  return [matrix, revIdx];
}

/**
 * Make a function that will take in a chord and return the appropriate color.
 * REFACTOR (2026-07): converted to TypeScript with null-safe access to field
 * config (color mode, mappings, display processors); behavior unchanged.
 * @param colorBySource Whether chords are colored the same as the source of
 *   the chord or the target
 * @param nameRevIdx A map of chord endpoint indices to names
 * @param frame The data frame being visualized
 * @param src The data series that will act as the source
 * @param target The data series that will act as the target
 * @param val The data series that will act as the value
 */
// TESTING (2026-07): exported so unit tests can exercise the color
// resolution logic directly (see chord.test.ts).
export function makeColorer(
  colorBySource: boolean,
  nameRevIdx: Map<number, string>,
  frame: DataFrame,
  src?: string,
  target?: string,
  val?: string
) {
  let sourceField: Field | undefined;
  let targetField: Field | undefined;
  let valueField: Field | undefined;

  frame.fields.forEach((curr) => {
    if (curr.name === src) {
      sourceField = curr;
    }
    if (curr.name === target) {
      targetField = curr;
    }
    if (curr.name === val) {
      valueField = curr;
    }
  });

  const fallback = (index: number) => classicColors[index % classicColors.length];

  const color = (v: ChordDatum): string => {
    if ('source' in v && 'target' in v) {
      if (colorBySource) {
        return color(v.source);
      }
      return color(v.target);
    }
    const curr = colorBySource ? sourceField : targetField;
    if (!curr) {
      return fallback(v.index);
    }
    const colorMode = curr.config.color?.mode;

    // Are we in some discrete color mode (i.e. non-gradient).
    if (colorMode === FieldColorModeId.PaletteClassic || colorMode === FieldColorModeId.Fixed) {
      const name = nameRevIdx.get(v.index);
      // A mapping override exists for this value
      const mappings = curr.config.mappings ?? [];
      if (name !== undefined && mappings.some((m) => Object.prototype.hasOwnProperty.call(m.options ?? {}, name))) {
        return curr.display?.(name).color ?? fallback(v.index);
      }
      // The classic palette ties a specific color to an entire series. For
      // this plugin, we want to tie a specific color to a value in the series.
      if (colorMode === FieldColorModeId.PaletteClassic) {
        return fallback(v.index);
      }
      return curr.display?.(v.index).color ?? fallback(v.index);
    }

    // Otherwise, we're going to look at the value directly to decide on the
    // color.
    return valueField?.display?.(v.value).color ?? fallback(v.index);
  };
  return color;
}
