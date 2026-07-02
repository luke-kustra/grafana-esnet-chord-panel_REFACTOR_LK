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

## 5. Testing

### Unit tests (Jest + React Testing Library, jsdom — no Grafana needed)

Files: `tests/unit/` (see section 7 for the 2026-07-02 reorganization)
Support files: `jest.config.js`, `tests/jest-setup.js` (jsdom polyfills), `tests/mocks/style.js`

**`tests/unit/data.test.ts` — matrix builder (11 tests)**

- builds `matrix[sourceIdx][targetIdx] = value` with an index→name lookup map
- aggregates repeated source/target pairs
- guesses the first three columns when no field names are configured
- resolves fields configured by *display* name (e.g. `displayName` overrides)
- returns a failure with a human-readable reason for each bad-input case:
  configured field absent from the data, non-numeric value field, missing
  frame, zero rows, null source/target values

**`tests/unit/colors.test.ts` — color resolution (7 tests)**

- classic-palette color assignment by matrix index, with wrap-around
- chord colored by its source vs. target depending on the `colorBySource` option
- fixed color mode, value-mapping overrides, and by-value gradient modes
- palette fallback when the driving field is missing

**`tests/unit/chord.test.ts` — d3 rendering (8 tests)**

- renders one ribbon per data row, one arc/label/tick per node, palette fills
- **no native `<title>` elements remain** (regression guard for the tooltip switch)
- `pointermove` on a ribbon invokes the tooltip callback with the label in
  **data direction** (`source → target`); `pointerout` invokes it with `null`
- `pointermove` on an outer arc reports the node total (incoming + outgoing)
- guard clauses: too-small panel (in either dimension) and an oversized Text
  Length render nothing
- re-rendering clears previous contents (no duplicated nodes)

**`tests/unit/ChordPanel.test.tsx` — panel component (7 tests)**

- shows the "Please set Source, Target and Value Field Options" message when field options are missing
- shows the preparation failure reason (unknown field, non-numeric value field) as panel text
- renders the chord SVG when options are set
- **Grafana tooltip lifecycle**: hovering a chord renders the tooltip through a React `Portal` (asserted to be *outside* the panel SVG — i.e. Grafana's tooltip, not a native one); `pointerout` removes it; a data refresh mid-hover clears it
- rules-of-hooks regression test: flipping between the configured and unconfigured branches re-renders without crashing (the pre-refactor component called hooks conditionally and could crash exactly here)

**`tests/unit/module.test.ts` — plugin wiring (4 tests)**

- exports a `PanelPlugin` wrapping `ChordPanel`
- registers the expected options (`targetField`, `sourceField`, `valueField`, `colorBySource`, `txtLength`, `pointLength`, `labelSize`) with their defaults (order-independent assertions)
- the shared `listFieldNames` loader lists field display names from the first frame only, and returns nothing without data

**jsdom polyfills** (`tests/jest-setup.js`): `TextEncoder`/`TextDecoder` (needed by `react-dom/server` via `@grafana/ui`), `ResizeObserver` (used by `VizTooltipContainer`), `matchMedia`, and `SVGElement.getComputedTextLength` (used by the label word-wrapper).

Run them:

```bash
npm test                             # all unit tests
npx jest --watch                     # watch mode
npx jest tests/unit/chord.test.ts    # a single suite
```

### End-to-end test (Playwright + @grafana/plugin-e2e — NO Docker)

Files: `tests/e2e/chordPanel.spec.ts`, `playwright.config.ts`, `provisioning/datasources/testdata.yaml`

**Strategy.** The tests run against a *locally installed* Grafana (no Docker). The `/api/ds/query` response is mocked with a fixed source/target/value frame (`panelEditPage.mockQueryDataResponse`), so the test doesn't depend on any datasource-editor UI internals and stays focused on this plugin: panel registration, the Display option editors, d3 rendering, and the Grafana tooltip.

Two tests:

1. **Unconfigured state** — selecting the ESnet Chord visualization without field options shows the configuration prompt.
2. **Full render + tooltip** — sets Source/Target/Value via the panel's Display options, then asserts: 3 chord ribbons render, outer labels show node names, **zero native `<title>` elements exist**, hovering a ribbon shows Grafana's tooltip (`X → Y` text in a portal), and moving the pointer away hides it.

**One-time setup:**

```bash
brew install grafana             # local Grafana, no Docker
npx playwright install chromium  # browser for Playwright
npm run build                    # produce dist/ (what Grafana loads)
```

**Start an isolated Grafana instance** (throwaway data dir on port 3333; does not touch any existing Grafana install or config):

```bash
E2E_HOME=/tmp/grafana-chord-e2e
mkdir -p $E2E_HOME/data $E2E_HOME/logs $E2E_HOME/plugins \
         $E2E_HOME/provisioning/{datasources,dashboards,plugins,alerting,notifiers}
ln -sfn "$(pwd)/dist" $E2E_HOME/plugins/esnet-chord-panel
cp provisioning/datasources/testdata.yaml $E2E_HOME/provisioning/datasources/

GF_SERVER_HTTP_PORT=3333 \
GF_PATHS_DATA=$E2E_HOME/data \
GF_PATHS_LOGS=$E2E_HOME/logs \
GF_PATHS_PLUGINS=$E2E_HOME/plugins \
GF_PATHS_PROVISIONING=$E2E_HOME/provisioning \
GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=esnet-chord-panel \
grafana server --homepath /opt/homebrew/opt/grafana/share/grafana
```

(`allow_loading_unsigned_plugins` is required because local dev builds are unsigned. On Intel Macs the homepath is `/usr/local/opt/grafana/share/grafana`.)

**Run the tests** (in a second terminal):

```bash
GRAFANA_URL=http://localhost:3333 npm run e2e
npm run e2e:report    # open the HTML report
```

The `auth` project logs in automatically with Grafana's default `admin`/`admin` credentials and stores the session in `playwright/.auth/` (git-ignored).

To run against an already-running Grafana instead, point `GRAFANA_URL` at it — it needs this plugin in its plugins directory (unsigned allowed) and the TestData datasource from `provisioning/datasources/testdata.yaml`.

### Verified results (2026-07-01)

- Unit: **21/21 passing** (`npm test`)
- E2E: **3/3 passing** (auth setup + 2 specs) against a local Homebrew **Grafana 13.0.2** using the isolated-instance steps above — which also confirms `VizTooltipContainer` works at runtime on current Grafana
- `npm run typecheck`, `npm run lint`, and `npm run build` all clean

### Other checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint over src/
npm run build       # production bundle into dist/
```

## 6. Manual testing

### Installing the plugin into a local (Homebrew) Grafana

The visualization picker only lists panels that Grafana found in its plugins
directory at startup, and unsigned dev builds must be explicitly allowlisted.
For a Homebrew Grafana on Apple Silicon:

```bash
npm run build   # make sure dist/ is current

# 1. Link the built plugin into Grafana's plugins directory
#    (a symlink means rebuilds are picked up on the next restart;
#     use `cp -r` instead if you prefer a frozen copy)
ln -sfn "$(pwd)/dist" /opt/homebrew/var/lib/grafana/plugins/esnet-chord-panel

# 2. Allow the unsigned plugin: in /opt/homebrew/etc/grafana/grafana.ini,
#    under [plugins], add esnet-chord-panel to the comma-separated list:
#    allow_loading_unsigned_plugins = ...,esnet-chord-panel

# 3. Restart Grafana so it rescans plugins
brew services restart grafana
```

Verify it loaded: `curl -s -u admin:<password> http://localhost:3000/api/plugins/esnet-chord-panel/settings`
or check the Grafana log for `Plugin is unsigned` + `id=esnet-chord-panel`
(warn is fine — it means the allowlist worked).

Then: dashboard → Add panel → visualization picker → search **"ESnet Chord"**.

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

### Manual test checklist

1. Panel options → **Display** → set Source Field = `source`, Target Field =
   `target`, Value Field = `value`. Before configuring them you should see
   the "Please set Source, Target and Value Field Options" prompt.
2. **Hover chords and outer arcs** — tooltips should be Grafana-styled
   (theme-aware, following the pointer): `X → Y : value` for chords, node
   totals for arcs. They must vanish on mouse-out and on data refresh.
3. **Standard options → Unit** — e.g. Data rate → Gbit/s; tooltip values
   should pick up the suffix.
4. **Standard options → Color scheme** — try a "by value" gradient (e.g.
   Green-Yellow-Red) for value-based coloring; with the classic palette,
   flip **Display → Color By** between Source and Target.
5. Resize the panel below ~380px in either dimension — it should blank out
   and reappear when enlarged.
6. Configure a Source/Target/Value field that doesn't exist in the data, or
   a non-numeric Value field — the panel should show a message explaining
   the problem instead of rendering blank.

## 7. 2026-07-02 follow-up refactor

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
