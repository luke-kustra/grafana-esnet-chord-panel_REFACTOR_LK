// REFACTOR (2026-07-02): Data preparation (prepData) is now invoked here,
// memoized on the panel data and the three field options, and passed into
// createViz. Two consequences:
//  - Resizing the panel redraws the SVG without re-aggregating the data.
//  - Preparation failures (bad field names, non-numeric values, no data)
//    carry a reason that is rendered as panel text instead of a silent
//    blank panel + console noise.
//
// Earlier refactor (2026-07): renamed from esnetChord; fixed
// rules-of-hooks violations (all hooks now run unconditionally at the top);
// native SVG <title> tooltips replaced with Grafana's Portal +
// VizTooltipContainer; the d3 redraw only happens when its inputs change so
// tooltip state updates don't rebuild the SVG on each mouse move.
import React, { useCallback, useMemo, useState } from 'react';
import { PanelProps } from '@grafana/data';
import { Portal, useTheme2, VizTooltipContainer } from '@grafana/ui';

import { ChordOptions } from './types';
import { createViz, ChordTooltipData } from './chord';
import { prepData } from './data';
import { useD3 } from './useD3';

interface Props extends PanelProps<ChordOptions> {}

export const ChordPanel = ({ options, data, width, height }: Props) => {
  // Hooks first, unconditionally (this ordering is required by React).
  const theme = useTheme2();
  const [tooltip, setTooltip] = useState<ChordTooltipData | null>(null);
  const onTooltip = useCallback((t: ChordTooltipData | null) => setTooltip(t), []);

  const hasRequiredFields = Boolean(options.sourceField && options.targetField && options.valueField);

  // Memoized separately from rendering so redraws (e.g. on resize) reuse the
  // aggregated matrix.
  const prep = useMemo(
    () => prepData(data.series[0], options.sourceField, options.targetField, options.valueField),
    [data, options.sourceField, options.targetField, options.valueField]
  );

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      // Clear any lingering tooltip before redrawing. If the data refreshes
      // while a chord is hovered, the hovered element is destroyed by the
      // redraw and its pointerout never fires, which would otherwise leave
      // the tooltip stuck on screen.
      onTooltip(null);
      if (hasRequiredFields && prep.ok) {
        createViz(svg, {
          prep,
          width,
          height,
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
    [prep, width, height, options, theme, hasRequiredFields, onTooltip]
  );

  const message = !hasRequiredFields
    ? 'Please set Source, Target and Value Field Options'
    : !prep.ok
      ? prep.reason
      : null;

  if (message !== null) {
    return (
      <svg width={width} height={height}>
        <text x="0" y="15" fill={theme.colors.text.primary}>
          {message}
        </text>
      </svg>
    );
  }

  return (
    <>
      <svg ref={ref} width={width} height={height} />
      {/* Grafana-native tooltip rendering. Portal mounts the tooltip at the
          document root (so it is not clipped by the panel) and
          VizTooltipContainer provides Grafana's standard themed tooltip
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
