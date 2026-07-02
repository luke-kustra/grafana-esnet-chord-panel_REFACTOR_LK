// REFACTOR (2026-07-02): This module is now rendering-only. The matrix
// aggregation (prepData) moved to data.ts and color resolution (makeColorer)
// moved to colors.ts; createViz receives the prepared matrix via
// ChordVizOptions.prep instead of raw PanelData, so the panel can memoize
// data preparation independently of redraws (a resize no longer re-aggregates
// the data). The magic layout numbers (band width, tick length, minimum
// radius, label-collapse threshold) are now named constants.
//
// Earlier refactor (2026-07): converted from chord.js to TypeScript; d3 from
// npm instead of a vendored minified copy; native SVG <title> tooltips
// replaced by an onTooltip callback rendered with Grafana's tooltip in
// ChordPanel.tsx; React hooks moved out of this module.
import * as d3 from 'd3';
import { DisplayProcessor, GrafanaTheme2 } from '@grafana/data';

import { PrepSuccess } from './data';
import { ChordDatum, makeColorer } from './colors';

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
  /** prepared adjacency matrix + resolved fields (see prepData in data.ts) */
  prep: PrepSuccess;
  width: number;
  height: number;
  txtLen: number;
  labelSize: number;
  colorBySource: boolean;
  pointLength: number;
  theme: GrafanaTheme2;
  onTooltip: TooltipCallback;
}

/** Below this radius the diagram is unreadable, so nothing is rendered. */
export const MIN_RADIUS = 180;
/** Minimum radius left for the chords after reserving label space; guards
 *  against a large Text Length driving the inner radius negative. */
export const MIN_INNER_RADIUS = 20;
/** Thickness of the outer arc band. */
const BAND_WIDTH = 12;
/** Gap between the outer band and the start of a label. */
const LABEL_MARGIN = 4;
/** Length of the small tick between an arc and its label. */
const TICK_LENGTH = 4;
/** Arcs spanning less than this angle (radians) collapse their label. */
const LABEL_COLLAPSE_ANGLE = 0.025;
const LABEL_COLLAPSE_TEXT = '. . .';

/**
 * Create the chord diagram using d3.
 * @param elem The parent svg element that will house this diagram
 * @param options All rendering inputs (prepared data, sizing, theme, and the
 *   tooltip callback) as a single typed object.
 */
export function createViz(elem: SVGSVGElement | null, options: ChordVizOptions): void {
  const { prep, width, height, txtLen, labelSize, colorBySource, pointLength, theme, onTooltip } = options;

  if (elem === null) {
    return;
  }
  while (elem.firstChild) {
    // clear out old contents
    elem.removeChild(elem.lastChild!);
  }

  const svg = d3.select(elem);

  // The diagram is square; fit it to the shorter panel dimension so the
  // size guards below reflect what is actually drawn.
  const diameter = Math.min(width, height);
  const radius = diameter / 2;

  svg.attr('viewBox', `${-radius}, ${-radius}, ${diameter}, ${diameter}`);

  if (radius < MIN_RADIUS) {
    // too small to do anything useful
    return;
  }
  // leave room for labels on outside
  const innerRadius = radius - (txtLen + LABEL_MARGIN + BAND_WIDTH);
  // sets size of outer band
  const outerRadius = innerRadius + BAND_WIDTH;

  if (innerRadius < MIN_INNER_RADIUS) {
    // the configured Text Length leaves no room for the chords
    return;
  }

  const { matrix, names, sourceField, targetField, valueField } = prep;

  // Grafana attaches a display processor to fields it has processed; fall
  // back to a plain text formatter when one is absent.
  const fieldDisplay: DisplayProcessor =
    valueField.display ?? ((value: unknown) => ({ text: String(value), numeric: Number(value) }));

  const arc = d3.arc<d3.ChordGroup>().innerRadius(innerRadius).outerRadius(outerRadius);

  const ribbon = d3
    .ribbonArrow<d3.Chord, d3.ChordSubgroup>()
    .radius(innerRadius - 2)
    .padAngle(2 / innerRadius)
    .headRadius(innerRadius * (pointLength / 100.0));
  // The @types/d3 ribbon generator's first overload is typed for
  // canvas-context rendering (returning void), but with no context set it
  // returns an SVG path string.
  const ribbonPath = (d: d3.Chord) => ribbon(d) as unknown as string;

  const chordLayout = d3
    .chordDirected()
    .padAngle(12 / innerRadius)
    .sortSubgroups(d3.descending)
    .sortChords(d3.descending);

  const chords = chordLayout(matrix);

  // build ordinal color scale keyed on index used in the matrix
  const color = makeColorer(colorBySource, names, { sourceField, targetField, valueField });

  // Darken helper; d3.color() can return null so guard before calling darker.
  const darker = (d: ChordDatum) => d3.color(color(d))?.darker()?.toString() ?? null;

  // Tooltip helpers: hover data is forwarded to React via onTooltip so it can
  // be rendered with Grafana's themed tooltip.
  const formatValue = (value: number) => {
    const disp = fieldDisplay(value);
    return `${disp.text}${disp.suffix ? ` ${disp.suffix}` : ''}`;
  };
  const chordTooltip = (event: PointerEvent, d: d3.Chord) => {
    onTooltip({
      label: `${names.get(d.source.index)} → ${names.get(d.target.index)}`,
      value: formatValue(d.source.value),
      x: event.clientX,
      y: event.clientY,
    });
  };
  const groupTooltip = (event: PointerEvent, d: d3.ChordGroup) => {
    // A directed chord group's value is the sum of its incoming AND outgoing
    // flows (see d3-chord's groupSums), i.e. the total through the node.
    onTooltip({
      label: `${names.get(d.index)} (total)`,
      value: formatValue(d.value),
      x: event.clientX,
      y: event.clientY,
    });
  };
  const hideTooltip = () => onTooltip(null);

  // generate the inner chords
  svg
    .append('g')
    .attr('fill-opacity', 0.99)
    .selectAll('path')
    .data(chords)
    .join('path')
    .attr('d', ribbonPath)
    .attr('fill', (d) => color(d))
    .attr('stroke', (d) => darker(d))
    .style('mix-blend-mode', 'normal')
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
        .on('pointermove', groupTooltip)
        .on('pointerout', hideTooltip)
    )
    .call((g) =>
      g
        .append('g')
        .attr('transform', (d) => {
          const rot = (((d.startAngle + d.endAngle) / 2) * 180) / Math.PI - 90;
          const trans = outerRadius + txtLen / 2 + LABEL_MARGIN;
          return `rotate(${rot}) translate(${trans}, 0)`;
        })
        .attr('fill', theme.colors.text.primary)
        .attr('font-size', labelSize)
        .append('text')
        .attr('text-anchor', (d) => (d.startAngle < Math.PI ? 'start' : 'end'))
        .attr('transform', (d) => (d.startAngle >= Math.PI ? 'rotate(180)' : null))
        // dont show if the "pie" is too small
        .text((d) => (d.endAngle - d.startAngle > LABEL_COLLAPSE_ANGLE ? names.get(d.index) ?? '' : LABEL_COLLAPSE_TEXT))
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
        .attr('x2', TICK_LENGTH)
    );
}

/**
 * Word-wrap the outer labels to fit within the reserved text length.
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
