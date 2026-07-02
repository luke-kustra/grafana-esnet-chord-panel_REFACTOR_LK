// TESTING (2026-07): End-to-end test for the ESnet Chord panel using
// @grafana/plugin-e2e + Playwright against a real, locally running Grafana
// (no Docker - see refactor_notes.md for setup).
//
// Strategy: rather than scripting the TestData query editor UI (whose
// internals vary between Grafana versions), the /api/ds/query response is
// mocked with a fixed source/target/value frame. This keeps the test focused
// on OUR plugin: panel registration, option editors, d3 rendering, and the
// Grafana tooltip that replaced the native <title> tooltips in the refactor.
import { expect, test } from '@grafana/plugin-e2e';

// A source/target/value data frame in the Grafana JSON wire format.
const queryDataResponse = {
  results: {
    A: {
      status: 200,
      frames: [
        {
          schema: {
            refId: 'A',
            fields: [
              { name: 'source', type: 'string', typeInfo: { frame: 'string' } },
              { name: 'target', type: 'string', typeInfo: { frame: 'string' } },
              { name: 'value', type: 'number', typeInfo: { frame: 'float64' } },
            ],
          },
          data: {
            values: [
              ['LBL', 'ANL', 'LBL'],
              ['ANL', 'CERN', 'CERN'],
              [10, 5, 3],
            ],
          },
        },
      ],
    },
  },
};

test('asks for field configuration before options are set', async ({ panelEditPage, readProvisionedDataSource }) => {
  const ds = await readProvisionedDataSource({ fileName: 'testdata.yaml' });
  await panelEditPage.mockQueryDataResponse(queryDataResponse);
  await panelEditPage.datasource.set(ds.name);
  await panelEditPage.setVisualization('ESnet Chord');

  await expect(
    panelEditPage.panel.locator.getByText('Please set Source, Target and Value Field Options')
  ).toBeVisible();
});

test('renders the chord diagram and shows a Grafana tooltip on hover', async ({
  page,
  panelEditPage,
  readProvisionedDataSource,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'testdata.yaml' });
  await panelEditPage.mockQueryDataResponse(queryDataResponse);
  await panelEditPage.datasource.set(ds.name);
  await panelEditPage.setVisualization('ESnet Chord');
  await panelEditPage.refreshPanel();

  // Configure the panel's Display options.
  const display = panelEditPage.getCustomOptions('Display');
  await display.getSelect('Source Field').selectOption('source');
  await display.getSelect('Target Field').selectOption('target');
  await display.getSelect('Value Field').selectOption('value');

  // The chord diagram renders: ribbons live in the first fill-opacity group.
  const svg = panelEditPage.panel.locator.locator('svg');
  const ribbons = svg.locator('g[fill-opacity] path');
  await expect(ribbons.first()).toBeVisible();
  await expect(ribbons).toHaveCount(3); // one ribbon per data row

  // Outer labels render the node names.
  await expect(svg.locator('text').filter({ hasText: 'LBL' })).toBeVisible();

  // TOOLTIP: hovering a chord shows Grafana's themed tooltip (rendered in a
  // portal at the document root, NOT a native SVG <title>).
  await expect(svg.locator('title')).toHaveCount(0);
  // Ribbons overlap near the center of the diagram, so a strict hover can be
  // rejected ("intercepts pointer events"); force it and accept whichever
  // ribbon is topmost at that point.
  await ribbons.first().hover({ force: true });
  // The label must read in DATA direction (source → target); a transposed
  // matrix would produce reversed labels (e.g. "ANL → LBL") matching none
  // of these.
  const tooltipLabel = page.getByText(/^(LBL → ANL|ANL → CERN|LBL → CERN)$/);
  await expect(tooltipLabel).toBeVisible();
  // The tooltip pairs the hovered chord with its aggregated value.
  const values: Record<string, string> = { 'LBL → ANL': '10', 'ANL → CERN': '5', 'LBL → CERN': '3' };
  const labelText = (await tooltipLabel.textContent())!;
  await expect(tooltipLabel.locator('xpath=following-sibling::div/strong')).toHaveText(values[labelText]);

  // Moving the pointer off the chord hides the tooltip again.
  await page.mouse.move(0, 0);
  await expect(page.getByText(/\s→\s/)).not.toBeVisible();
});
