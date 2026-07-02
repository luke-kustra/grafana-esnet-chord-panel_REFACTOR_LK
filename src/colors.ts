// REFACTOR (2026-07-02): Color resolution was extracted from chord.ts into
// its own module. makeColorer now receives the already-resolved Field
// objects (from prepData) instead of re-scanning frame.fields by name.
import type { Chord, ChordGroup, ChordSubgroup } from 'd3';
import { classicColors, Field, FieldColorModeId } from '@grafana/data';

export type ChordDatum = Chord | ChordGroup | ChordSubgroup;

export interface ChordFields {
  sourceField?: Field;
  targetField?: Field;
  valueField?: Field;
}

/**
 * Make a function that will take in a chord and return the appropriate color.
 *
 * @param colorBySource Whether chords are colored the same as the source of
 *   the chord or the target
 * @param names A map of chord endpoint indices to names
 * @param fields The resolved source/target/value fields, whose config
 *   (color mode, mappings, display processors) drives the resolution
 */
export function makeColorer(colorBySource: boolean, names: Map<number, string>, fields: ChordFields) {
  const { sourceField, targetField, valueField } = fields;
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
      const name = names.get(v.index);
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
