// TESTING (2026-07): Component tests for ChordPanel using React Testing
// Library. Covers:
//  - the "missing field options" guidance message
//  - visible error messages for bad configurations (unknown field,
//    non-numeric value field) instead of a silent blank panel
//  - full rendering of the chord SVG when options are set
//  - the Grafana tooltip lifecycle: appears (in a portal, outside the
//    panel's SVG) on chord hover, disappears on pointerout, and is cleared
//    when the data refreshes mid-hover
//  - no crash when the required-fields branch flips (the old component
//    violated the rules of hooks here)
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FieldType, PanelProps, toDataFrame } from '@grafana/data';

import { ChordPanel } from '../../src/ChordPanel';
import { ChordOptions } from '../../src/types';
import { buildPanelData } from './helpers';

const options: ChordOptions = {
  sourceField: 'source',
  targetField: 'target',
  valueField: 'value',
  txtLength: 100,
  labelSize: 12,
  colorBySource: true,
  pointLength: 10,
};

// ChordPanel only consumes options/data/width/height, so a partial PanelProps
// object is sufficient for rendering it in tests.
function buildProps(overrides: Partial<PanelProps<ChordOptions>> = {}): PanelProps<ChordOptions> {
  return {
    options,
    data: buildPanelData(),
    width: 600,
    height: 600,
    ...overrides,
  } as unknown as PanelProps<ChordOptions>;
}

describe('ChordPanel', () => {
  it('asks the user to configure fields when options are missing', () => {
    const props = buildProps({ options: { ...options, sourceField: '' } });
    render(<ChordPanel {...props} />);
    expect(screen.getByText('Please set Source, Target and Value Field Options')).toBeInTheDocument();
  });

  it('explains when a configured field is not present in the data', () => {
    const props = buildProps({ options: { ...options, sourceField: 'bogus' } });
    render(<ChordPanel {...props} />);
    expect(screen.getByText('Source field "bogus" not found in the query result')).toBeInTheDocument();
  });

  it('explains when the value field is not numeric', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'source', type: FieldType.string, values: ['LBL'] },
        { name: 'target', type: FieldType.string, values: ['ANL'] },
        { name: 'value', type: FieldType.string, values: ['fast'] },
      ],
    });
    render(<ChordPanel {...buildProps({ data: buildPanelData(frame) })} />);
    expect(screen.getByText(/non-numeric/)).toBeInTheDocument();
  });

  it('renders the chord diagram when all field options are set', () => {
    const { container } = render(<ChordPanel {...buildProps()} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toBeInTheDocument();
    // 3 data rows -> 3 ribbons; 3 names -> 3 outer arcs
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(5);
  });

  it('shows a Grafana tooltip on hover and hides it on pointerout', () => {
    const { container } = render(<ChordPanel {...buildProps()} />);
    const ribbon = container.querySelector('svg g[fill-opacity] path')!;

    // No tooltip before interaction
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();

    // fireEvent wraps the dispatch in act() so the tooltip state update
    // is flushed before we assert.
    fireEvent(ribbon, new MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 120 }));

    // The tooltip renders through a Portal (i.e., outside the panel SVG,
    // attached to document.body) with the "source → target" label and value.
    const label = screen.getByText(/→/);
    expect(label).toBeInTheDocument();
    expect(container.querySelector('svg')!.contains(label)).toBe(false);

    fireEvent(ribbon, new MouseEvent('pointerout', { bubbles: true }));
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });

  it('clears a lingering tooltip when the data refreshes mid-hover', () => {
    const { container, rerender } = render(<ChordPanel {...buildProps()} />);
    const ribbon = container.querySelector('svg g[fill-opacity] path')!;
    fireEvent(ribbon, new MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 120 }));
    expect(screen.getByText(/→/)).toBeInTheDocument();

    // A data refresh destroys the hovered element, so its pointerout never
    // fires; the redraw itself must clear the tooltip.
    rerender(<ChordPanel {...buildProps({ data: buildPanelData() })} />);
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });

  it('survives the required-fields branch flipping (rules-of-hooks regression test)', () => {
    // The pre-refactor component called hooks conditionally, which could
    // crash React exactly in this scenario: rendering with fields set,
    // then without, then with them again.
    const { rerender, container } = render(<ChordPanel {...buildProps()} />);
    rerender(<ChordPanel {...buildProps({ options: { ...options, valueField: '' } })} />);
    expect(screen.getByText('Please set Source, Target and Value Field Options')).toBeInTheDocument();
    rerender(<ChordPanel {...buildProps()} />);
    expect(container.querySelector('svg g[fill-opacity] path')).not.toBeNull();
  });
});
