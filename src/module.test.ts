// TESTING (2026-07): Replaced the old placeholder test (`expect(true)`) with
// real assertions that the plugin module wires up correctly.
import { PanelPlugin, toDataFrame, FieldType } from '@grafana/data';

import { plugin } from './module';
import { ChordPanel } from './ChordPanel';

describe('plugin module', () => {
  it('exports a PanelPlugin wrapping ChordPanel', () => {
    expect(plugin).toBeInstanceOf(PanelPlugin);
    expect(plugin.panel).toBe(ChordPanel);
  });

  it('registers the expected panel options', () => {
    // Building the options registry exercises the setPanelOptions callback.
    const supplier = plugin.getPanelOptionsSupplier();
    const builder: any = {
      addSelect: jest.fn().mockReturnThis(),
      addNumberInput: jest.fn().mockReturnThis(),
      addSliderInput: jest.fn().mockReturnThis(),
    };
    supplier(builder, { data: [] } as any);

    const selectPaths = builder.addSelect.mock.calls.map((c: any[]) => c[0].path);
    expect(selectPaths).toEqual(['targetField', 'sourceField', 'valueField', 'colorBySource']);

    const numberPaths = builder.addNumberInput.mock.calls.map((c: any[]) => c[0].path);
    expect(numberPaths).toEqual(['txtLength', 'pointLength']);

    expect(builder.addSliderInput).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'labelSize', defaultValue: 12 })
    );
  });

  it('lists field display names as options for the field selects', async () => {
    const supplier = plugin.getPanelOptionsSupplier();
    let getOptions: any;
    const builder: any = {
      addSelect: jest.fn().mockImplementation((cfg) => {
        if (cfg.path === 'sourceField') {
          getOptions = cfg.settings.getOptions;
        }
        return builder;
      }),
      addNumberInput: jest.fn().mockReturnThis(),
      addSliderInput: jest.fn().mockReturnThis(),
    };
    supplier(builder, { data: [] } as any);

    const frame = toDataFrame({
      fields: [
        { name: 'source', type: FieldType.string, values: ['a'] },
        { name: 'value', type: FieldType.number, values: [1] },
      ],
    });
    const result = await getOptions({ data: [frame] });
    expect(result).toEqual([
      { value: 'source', label: 'source' },
      { value: 'value', label: 'value' },
    ]);
  });
});
