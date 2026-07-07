# Refactor Notes

This document summarizes the changes made during the 2026-07-01 refactor of the Grafana ESnet Chord panel plugin, and the reasoning behind them.

## 1. Tooltip switched to Grafana's tooltip (the headline change)

- **Before:** `chord.js` appended native SVG `<title>` elements — the gray, unthemed, slow-to-appear browser tooltips.
- **After:** the d3 layer (`src/chord.ts`) emits hover data through pointer events (`pointermove`/`pointerout`) via an `onTooltip` callback, and `src/ChordPanel.tsx` renders it with `Portal` + `VizTooltipContainer` from `@grafana/ui` — Grafana's standard viz tooltip. It now follows the pointer, matches dark/light theme, and looks like every other Grafana panel's tooltip. Works for both the inner chords ("A → B : value") and the outer arcs ("Name (total)").

## 2. Build tooling modernized

- Replaced deprecated `@grafana/toolkit` (deprecated by Grafana in 2022) with a webpack 5 + SWC build (`webpack.config.js`) modeled on the official `@grafana/create-plugin` scaffold. It handles the AMD module output, Grafana runtime externals, and the `%VERSION%`/`%TODAY%` substitution the toolkit used to do.
- `tsconfig.json`, `jest.config.js`, `.prettierrc.js`, `.eslintrc.json` are now self-contained instead of reaching into toolkit internals; ESLint moved from `eslint-config-google` to `@grafana/eslint-config`.
- Moved from yarn to npm (`package-lock.json` now committed, per current practice).

## 3. Dependencies updated

- `@grafana/*` 8.3.0 → 11.6.16; minimum Grafana is now 10.4 (`plugin.json` updated). TypeScript 5.9, ESLint 8, Jest 29.
- d3 is now a real npm dependency — deleted the 274 KB vendored `src/d3.min.js` and `src/d3-color.v1.min.js` files. Webpack tree-shakes it: the final bundle is 54 KB (previously the whole minified d3 was inlined).
- Fixed a latent bug: `"Dependencies"` (capital D) in `package.json` was invalid JSON schema-wise and silently ignored; the `grafana-plugin-support` package it referenced was unused, so it's gone.

## 4. Code quality fixes

- Fixed React rules-of-hooks violations — `useTheme2()` was called only in the `else` branch and `useD3()` only in the `if` branch of `esnetChord.tsx`; that can crash React when the branch flips. All hooks now run unconditionally at the top of the renamed `ChordPanel.tsx`.
- Converted `chord.js`/`useD3.js` to TypeScript (`chord.ts`, `useD3.ts`) and deleted the hand-written `.d.ts` stubs. `useD3` now takes a dependency list so the SVG only redraws when data/size/options change — required so tooltip state updates don't rebuild the diagram on every mouse move.
- Resolved an old TODO: the value formatter was hard-coded to column index 2; it now resolves the field you actually pick as Value Field.
- `module.ts`: deduplicated three identical copy-pasted `getOptions` callbacks into one `listFieldNames` helper; fixed the Label Size slider missing its category; removed a stale JSDoc referencing "NetSageSankey" (copy-paste from a sibling plugin).
- Deleted cruft: committed vim swap file (`.chord.js.swp`); `dist/` is no longer ignored-in-name-only (`.gitignore` fixed).


## 5. 2026-07-02 follow-up refactor

A second pass over the codebase. Rendering output is unchanged for
well-formed data and default options. Changes:

### Module split

`src/chord.ts` was split into three single-purpose modules:

- **`src/data.ts`** — `prepData`: builds the adjacency matrix + index→name
  map for `d3.chordDirected`.
- **`src/colors.ts`** — `makeColorer`: resolves a chord/arc to a color from
  the field config (palette / fixed / mappings / by-value gradients).
- **`src/chord.ts`** — rendering only: `createViz` plus the label
  word-wrapper. No data access, no React.

### prepData rewritten

- No longer iterates a `DataFrameView` row proxy (which required
  `Object.keys()` on every row just to guess columns). The three `Field`
  objects are resolved once up front, then their value arrays are iterated
  directly.
- Field names are matched against both the raw `field.name` and the Grafana
  *display* name (`getFieldDisplayName`), since display names are what the
  option editors list.
- The `[null, null]` failure tuple was replaced with a discriminated union
  (`PrepResult`): `{ ok: true, matrix, names, sourceField, targetField,
  valueField }` or `{ ok: false, reason }`. The success value carries the
  resolved `Field` objects so `makeColorer` and the value formatter no
  longer re-scan `frame.fields`, and the failure reason is rendered as
  panel text (like the "Please set …" prompt) instead of `console.log` +
  a silently blank panel.

### ChordPanel

- `prepData` now runs in the panel, memoized on the panel data and the
  three field options, and the prepared result is passed into `createViz`.
  Resizing the panel redraws the SVG without re-aggregating the data.

### createViz

- The scattered magic numbers are named constants: `MIN_RADIUS` (180),
  `MIN_INNER_RADIUS`, `BAND_WIDTH` (12), `LABEL_MARGIN` (4), `TICK_LENGTH`
  (4), `LABEL_COLLAPSE_ANGLE` (0.025).
- The diagram sizes to `min(width, height)` (it is square), so the
  too-small guard now reflects what is actually drawn, and a guard on
  `MIN_INNER_RADIUS` protects against a Text Length large enough to consume
  the whole radius.
- The ribbon generator is typed via `d3.ribbonArrow<d3.Chord,
  d3.ChordSubgroup>()`; the one remaining cast (the generator's void return
  type, an artifact of `@types/d3` modeling canvas rendering) is localized
  and documented.

### module.ts

- `listFieldNames` offers only the first frame's fields, since only
  `data.series[0]` is visualized — fields from other frames could never
  render.

### Test reorganization (all testing files under `tests/`)

```
tests/
├── e2e/chordPanel.spec.ts     # Playwright e2e (unchanged location)
├── unit/
│   ├── data.test.ts           # prepData: matrix, aggregation, guessing,
│   │                          #   display-name resolution, failure reasons
│   ├── colors.test.ts         # makeColorer: palette, fixed, mappings,
│   │                          #   by-value gradient, fallbacks
│   ├── chord.test.ts          # createViz DOM output, tooltip callbacks,
│   │                          #   size guards, redraw clearing
│   ├── ChordPanel.test.tsx    # component: messages, tooltip lifecycle
│   │                          #   (incl. cleared on data refresh),
│   │                          #   rules-of-hooks regression
│   ├── module.test.ts         # plugin wiring (order-independent asserts)
│   └── helpers.ts             # shared frame/panel-data builders
├── jest-setup.js              # jsdom polyfills (moved from repo root)
├── mocks/style.js             # style/img stub (was jest-mocks/)
└── testing.d.ts               # jest-dom matcher types (was src/)
```

Config updates that came with the move: `jest.config.js` (`testMatch`,
`setupFilesAfterEnv`, `moduleNameMapper` paths), `tsconfig.json` (includes
`tests/`, dropped `rootDir` so the whole tree type-checks), and `npm run
lint` now covers `./src` and `./tests`.

Coverage grew from 21 to 37 unit tests; the e2e spec now asserts the exact
tooltip label/value pairing on hover.

### Verified results (2026-07-02)

- Unit: **37/37 passing** (`npm test`)
- E2E: **3/3 passing** against a local Homebrew **Grafana 13.0.2** using the
  isolated-instance steps in section 5
- `npm run typecheck`, `npm run lint`, and `npm run build` all clean


### Sample datasets

Use the **TestData** datasource → Scenario: **CSV Content**, and paste one of
the datasets below. Reminder: the panel must be at least ~380px in BOTH
dimensions or the chord intentionally renders blank (the diagram sizes to
the shorter panel dimension; `MIN_RADIUS` guard, see section 7).

**Dataset 1 — quick smoke test (3 nodes):**

```csv
source,target,value
LBL,ANL,10
ANL,CERN,5
LBL,CERN,3
```

**Dataset 2 — realistic ESnet-style traffic (7 sites, tests aggregation):**

```csv
source,target,value
LBL,ANL,42.5
LBL,ORNL,18.2
ANL,CERN,35.0
CERN,LBL,27.8
ORNL,BNL,12.4
BNL,FNAL,22.1
FNAL,CERN,31.6
SLAC,LBL,9.3
ANL,SLAC,14.7
CERN,BNL,25.9
LBL,ANL,7.5
BNL,LBL,16.0
ORNL,CERN,11.2
FNAL,ANL,8.8
SLAC,ORNL,6.4
CERN,FNAL,19.5
```

`LBL,ANL` appears twice (42.5 + 7.5) — its chord should show the aggregated
value **50** in the tooltip.

**Dataset 3 — edge cases (long labels + tiny slices):**

```csv
source,target,value
Lawrence Berkeley National Laboratory,Argonne National Laboratory,500
Argonne National Laboratory,European Organization for Nuclear Research,2
Oak Ridge,Lawrence Berkeley National Laboratory,1
```

The long names exercise the outer-label word-wrapper; the tiny values should
collapse their arc labels to "`. . .`".

## 6. 2026-07-07 feature/bugfix pass

Two tracked items: outer-ring tooltip unit, and Value Mapping support.

### Value Mapping support for node labels (feature)

- **Before:** Grafana value mappings were honored for arc/ribbon **colors**
  only (`src/colors.ts`). Node **names** — the outer arc labels and both
  tooltip labels — came straight from the raw `String(value)` in `prepData`,
  so a mapping like `LBL → Berkeley` never showed in the labels.
- **After:** `prepData` (`src/data.ts`) now also returns `displayNames`
  (matrix index → mapped/formatted label), computed by running each raw node
  value through its source/target field's Grafana display processor
  (`displayNameOf()`). `src/chord.ts` renders `displayNames` for the arc
  labels and the chord/group tooltip labels. Node **identity/aggregation is
  unchanged** — it still keys on the raw value (`names`), so `colors.ts`'s
  mapping/color lookups keep working; only the user-facing text changed.
- **Known limits (by design):** identity stays raw, so two distinct raw
  values that map to the same text remain separate nodes; a node seen as both
  source and target uses the first field's mapping (first-encounter wins); a
  numeric source/target field also gets unit/decimal formatting on its label
  (rare — source/target are almost always strings).

### Outer-ring tooltip "unit is undefined" (bug — already fixed by the refactor)

- The original `chord.js` printed `${disp.suffix}` unguarded on the outer arc
  `<title>`, showing the literal `undefined` when no unit was configured. The
  refactor already routes both inner and outer tooltips through the shared,
  suffix-guarded `formatValue` in `src/chord.ts`
  (`disp.suffix ? \` ${disp.suffix}\` : ''`), so it no longer occurs. This
  pass added regression tests and a clarifying comment to lock it in.

### Tests / verification (2026-07-07)

- Unit: **42/42 passing** (`npm test`) — added `displayNames` cases to
  `tests/unit/data.test.ts` and mapped-label + unit-suffix (no-`undefined`)
  cases to `tests/unit/chord.test.ts`.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean; `dist`
  rebuilt.
- Manual: add a Value mapping on the Source field (e.g. `LBL → Berkeley`) and
  confirm it shows in the arc label and both tooltips; hover an outer arc with
  no Unit set and confirm no trailing `undefined`, then set a Unit and confirm
  the suffix appears.

