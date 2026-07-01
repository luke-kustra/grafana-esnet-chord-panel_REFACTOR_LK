// REFACTOR (2026-07): Summary of changes in this file:
//  - Import updated: esnetChord.tsx was renamed to ChordPanel.tsx (PascalCase
//    component naming) and imports are now explicit relative paths.
//  - The three identical copy-pasted `getOptions` field-listing callbacks
//    (target/source/value selects) were deduplicated into a single
//    `listFieldNames` helper.
//  - Removed a stale JSDoc block that referenced "NetSageSankey" (copy-paste
//    leftover from a different ESnet plugin).
//  - The Label Size slider now declares the same 'Display' category as every
//    other option (it was previously missing, so it rendered outside the
//    Display section in the panel editor).
import {
  FieldOverrideContext,
  getFieldDisplayName,
  PanelPlugin,
  FieldConfigProperty,
  FieldColorModeId,
  SelectableValue,
} from '@grafana/data';

import { ChordOptions } from './types';
import { ChordPanel } from './ChordPanel';

const OptionsCategory = ['Display'];

/**
 * Shared options-loader for the Source/Target/Value select editors: lists
 * the display names of every field in the current query result.
 */
const listFieldNames = async (context: FieldOverrideContext): Promise<Array<SelectableValue<string>>> => {
  const options: Array<SelectableValue<string>> = [];
  if (context && context.data) {
    for (const frame of context.data) {
      for (const field of frame.fields) {
        const name = getFieldDisplayName(field, frame, context.data);
        options.push({ value: name, label: name });
      }
    }
  }
  return options;
};

export const plugin = new PanelPlugin<ChordOptions>(ChordPanel);

plugin.setPanelOptions((builder) => {
  builder.addSelect({
    path: 'targetField',
    name: 'Target Field',
    description: 'Select the field to use as the target ',
    category: OptionsCategory,
    settings: {
      allowCustomValue: false,
      options: [],
      getOptions: listFieldNames,
    },
    // ---- todo: figure out how to guess at a default for these
    // defaultValue: options[1],
  });
  builder.addSelect({
    path: 'sourceField',
    name: 'Source Field',
    description: 'Select the fields that should be used as the source',
    category: OptionsCategory,
    settings: {
      allowCustomValue: false,
      options: [],
      getOptions: listFieldNames,
    },
    // defaultValue: options[0],
  });
  builder.addSelect({
    path: 'valueField',
    name: 'Value Field',
    description: 'Select the numeric field used to size and color chords.',
    category: OptionsCategory,
    settings: {
      allowCustomValue: false,
      options: [],
      getOptions: listFieldNames,
    },
    // defaultValue: options[2],
  });
  builder.addNumberInput({
    path: 'txtLength',
    name: 'Text Length',
    description: 'adjust amount of space used for labels',
    category: OptionsCategory,
    settings: {
      placeholder: 'Auto',
      integer: true,
      min: 1,
      max: 200,
    },
    defaultValue: 100,
  });
  builder.addSliderInput({
    path: 'labelSize',
    name: 'Label Size',
    description: 'The font size to use for outer labels',
    category: OptionsCategory,
    defaultValue: 12,
    settings: {
      min: 10,
      max: 16,
      step: 1,
    },
  });
  builder.addSelect({
    path: 'colorBySource',
    name: 'Color By',
    description:
      "Set the chord's color to the source or target of the " +
      "chord. When a 'by value' color scheme is selected, this has no effect",
    category: OptionsCategory,
    settings: {
      allowCustomValue: false,
      options: [
        { value: true, label: 'Source' },
        { value: false, label: 'Target' },
      ],
    },
    defaultValue: true,
  });
  builder.addNumberInput({
    path: 'pointLength',
    name: 'Point Length',
    // BUGFIX (2026-07): the two concatenated string literals were missing a
    // space between them ("of theradius" in the editor UI).
    description: 'Adjust the length of the chord point as a percentage of the radius of the chord diagram.',
    category: OptionsCategory,
    settings: {
      placeholder: 'Auto',
      integer: true,
      min: 0,
      max: 100,
    },
    defaultValue: 10,
  });
});

plugin.useFieldConfig({
  disableStandardOptions: [
    FieldConfigProperty.NoValue,
    FieldConfigProperty.Max,
    FieldConfigProperty.Min,
    FieldConfigProperty.DisplayName,
    FieldConfigProperty.Thresholds,
  ],
  standardOptions: {
    [FieldConfigProperty.Color]: {
      settings: {
        byValueSupport: true,
        bySeriesSupport: true,
        preferThresholdsMode: false,
      },
      defaultValue: {
        mode: FieldColorModeId.PaletteClassic,
      },
    },
  },
});
