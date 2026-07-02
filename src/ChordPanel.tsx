// REFACTOR (2026-07): This component was previously src/esnetChord.tsx.
// Summary of changes:
//  - Renamed esnetChord -> ChordPanel (React components should be
//    PascalCase; lowercase component names break JSX resolution and linting).
//  - FIXED RULES-OF-HOOKS VIOLATIONS: the old component called useTheme2()
//    only in the else-branch and called chord() (which internally used
//    useD3/useTheme2) only in the if-branch. Hooks called conditionally can
//    crash React whenever the branch flips. All hooks are now called
//    unconditionally at the top of the component.
//  - TOOLTIP CHANGE: hover details previously rendered as native SVG
//    <title> browser tooltips inside chord.js. The d3 layer now reports
//    hover state via a callback, and this component renders it with
//    Grafana's own tooltip primitives (Portal + VizTooltipContainer from
//    @grafana/ui), so tooltips follow the Grafana theme (dark/light) and
//    look like every other panel's tooltip.
//  - The d3 redraw now only happens when data/size/options/theme change,
//    not on every render (necessary so tooltip state updates don't rebuild
//    the whole SVG on each mouse move).
import React, { useCallback, useState } from 'react';
import { PanelProps } from '@grafana/data';
import { Portal, useTheme2, VizTooltipContainer } from '@grafana/ui';

import { ChordOptions } from './types';
import { createViz, ChordTooltipData } from './chord';
import { useD3 } from './useD3';

interface Props extends PanelProps<ChordOptions> {}

export const ChordPanel = ({ options, data, width, height }: Props) => {
  // Hooks first, unconditionally (this ordering is required by React).
  const theme = useTheme2();
  const [tooltip, setTooltip] = useState<ChordTooltipData | null>(null);
  const onTooltip = useCallback((t: ChordTooltipData | null) => setTooltip(t), []);

  const hasRequiredFields = Boolean(options.sourceField && options.targetField && options.valueField);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      // BUGFIX (2026-07): clear any lingering tooltip before redrawing. If
      // the data refreshes while a chord is hovered, the hovered element is
      // destroyed by the redraw and its pointerout never fires, which would
      // otherwise leave the tooltip stuck on screen.
      onTooltip(null);
      if (hasRequiredFields) {
        createViz(svg, {
          data,
          height,
          src: options.sourceField,
          target: options.targetField,
          val: options.valueField,
          txtLen: options.txtLength,
          labelSize: options.labelSize,
          colorBySource: options.colorBySource,
          pointLength: options.pointLength,
          theme,
          onTooltip,
        });
      }
    },
    // Redraw only when the inputs to the visualization change.
    [data, width, height, options, theme, hasRequiredFields, onTooltip]
  );

  if (!hasRequiredFields) {
    return (
      <svg width={width} height={height}>
        <text x="0" y="15" fill={theme.colors.text.primary}>
          Please set Source, Target and Value Field Options
        </text>
      </svg>
    );
  }

  return (
    <>
      <svg ref={ref} width={width} height={height} />
      {/* REFACTOR (2026-07): Grafana-native tooltip rendering. Portal mounts
          the tooltip at the document root (so it is not clipped by the panel)
          and VizTooltipContainer provides Grafana's standard themed tooltip
          chrome and positioning. */}
      {tooltip && (
        <Portal>
          <VizTooltipContainer position={{ x: tooltip.x, y: tooltip.y }} offset={{ x: 10, y: 10 }}>
            <div>{tooltip.label}</div>
            <div>
              <strong>{tooltip.value}</strong>
            </div>
          </VizTooltipContainer>
        </Portal>
      )}
    </>
  );
};
