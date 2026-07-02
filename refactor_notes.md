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

Files: `src/chord.test.ts`, `src/ChordPanel.test.tsx`, `src/module.test.ts`
Support files: `jest.config.js`, `jest-setup.js` (jsdom polyfills), `jest-mocks/style.js`

**`src/chord.test.ts` — d3 rendering module (14 tests)**

- `prepData` (adjacency-matrix builder):
  - builds `matrix[targetIdx][sourceIdx] = value` with a reverse name-lookup map
  - aggregates repeated source/target pairs
  - guesses the first three columns when no field names are configured
  - returns nulls (renders nothing) when the configured fields are absent from the data
- `makeColorer` (color resolution):
  - classic-palette color assignment by matrix index
  - chord colored by its source vs. target depending on the `colorBySource` option
  - palette wrap-around when there are more nodes than palette colors
- `createViz` (DOM output into a real SVG element):
  - renders one ribbon per data row, one arc/label/tick per node, palette fills
  - **no native `<title>` elements remain** (regression guard for the tooltip switch)
  - `pointermove` on a ribbon invokes the tooltip callback with `{label: "X → Y", value, x, y}`; `pointerout` invokes it with `null`
  - `pointermove` on an outer arc reports the node total
  - guard clauses: too-small panel (radius < 180) and empty data render nothing
  - re-rendering clears previous contents (no duplicated nodes)
  - Note: tooltip labels follow the legacy matrix orientation (`matrix[target][source]`), identical to the pre-refactor `<title>` text.

**`src/ChordPanel.test.tsx` — panel component (4 tests)**

- shows the "Please set Source, Target and Value Field Options" message when field options are missing
- renders the chord SVG when options are set
- **Grafana tooltip lifecycle**: hovering a chord renders the tooltip through a React `Portal` (asserted to be *outside* the panel SVG — i.e. Grafana's tooltip, not a native one); `pointerout` removes it
- rules-of-hooks regression test: flipping between the configured and unconfigured branches re-renders without crashing (the pre-refactor component called hooks conditionally and could crash exactly here)

**`src/module.test.ts` — plugin wiring (3 tests)**

- exports a `PanelPlugin` wrapping `ChordPanel`
- registers the expected options (`targetField`, `sourceField`, `valueField`, `colorBySource`, `txtLength`, `pointLength`, `labelSize`) with their defaults
- the shared `listFieldNames` loader lists field display names from panel data

**jsdom polyfills** (`jest-setup.js`): `TextEncoder`/`TextDecoder` (needed by `react-dom/server` via `@grafana/ui`), `ResizeObserver` (used by `VizTooltipContainer`), `matchMedia`, and `SVGElement.getComputedTextLength` (used by the label word-wrapper).

Run them:

```bash
npm test                      # all unit tests
npx jest --watch              # watch mode
npx jest src/chord.test.ts    # a single suite
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
the datasets below. Reminder: the panel must be at least ~380px tall or the
chord intentionally renders blank (legacy `radius < 180` guard).

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
5. Resize the panel below ~380px tall — it should blank out (legacy guard)
   and reappear when enlarged.
