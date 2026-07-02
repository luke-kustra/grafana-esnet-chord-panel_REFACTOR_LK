// TESTING (2026-07): Assertions that the plugin module wires up correctly.
// Option-path assertions are order-independent so harmless editor
// reordering does not break the suite.
import { PanelPlugin, toDataFrame, FieldType } from '@grafana/data';

import { plugin } from '../../src/module';
import { ChordPanel } from '../../src/ChordPanel';

function buildBuilder() {
  const builder: any = {
    addSelect: jest.fn().mockReturnThis(),
    addNumberInput: jest.fn().mockReturnThis(),
    addSliderInput: jest.fn().mockReturnThis(),
  };
  return builder;
}

describe('plugin module', () => {
  it('exports a PanelPlugin wrapping ChordPanel', () => {
    expect(plugin).toBeInstanceOf(PanelPlugin);
    expect(plugin.panel).toBe(ChordPanel);
  });

  it('registers the expected panel options', () => {
    // Building the options registry exercises the setPanelOptions callback.
    const supplier = plugin.getPanelOptionsSupplier();
    const builder = buildBuilder();
    supplier(builder, { data: [] } as any);

    const selectPaths = builder.addSelect.mock.calls.map((c: any[]) => c[0].path);
    expect(selectPaths.sort()).toEqual(['colorBySource', 'sourceField', 'targetField', 'valueField']);

    const numberPaths = builder.addNumberInput.mock.calls.map((c: any[]) => c[0].path);
    expect(numberPaths.sort()).toEqual(['pointLength', 'txtLength']);

    expect(builder.addSliderInput).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'labelSize', defaultValue: 12 })
    );
  });

  it('lists field display names from the first frame only', async () => {
    const supplier = plugin.getPanelOptionsSupplier();
    let getOptions: any;
    const builder = buildBuilder();
    builder.addSelect.mockImplementation((cfg: any) => {
      if (cfg.path === 'sourceField') {
        getOptions = cfg.settings.getOptions;
      }
      return builder;
    });
    supplier(builder, { data: [] } as any);

    const first = toDataFrame({
      fields: [
        { name: 'source', type: FieldType.string, values: ['a'] },
        { name: 'value', type: FieldType.number, values: [1] },
      ],
    });
    // Fields from later frames are never rendered (only series[0] is), so
    // they must not be offered as options.
    const second = toDataFrame({
      fields: [{ name: 'other', type: FieldType.string, values: ['x'] }],
    });
    const result = await getOptions({ data: [first, second] });
    expect(result).toEqual([
      { value: 'source', label: 'source' },
      { value: 'value', label: 'value' },
    ]);
  });

  it('returns no options when there is no data', async () => {
    const supplier = plugin.getPanelOptionsSupplier();
    let getOptions: any;
    const builder = buildBuilder();
    builder.addSelect.mockImplementation((cfg: any) => {
      if (cfg.path === 'sourceField') {
        getOptions = cfg.settings.getOptions;
      }
      return builder;
    });
    supplier(builder, { data: [] } as any);

    expect(await getOptions({ data: [] })).toEqual([]);
    expect(await getOptions({})).toEqual([]);
  });
});
