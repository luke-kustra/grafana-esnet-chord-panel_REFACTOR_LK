// REFACTOR (2026-07): Previously delegated to the deprecated
// @grafana/toolkit jest config. Now a self-contained Jest 29 setup using
// @swc/jest for transforms (mirroring the @grafana/create-plugin scaffold).

// d3 v7 and friends ship as ESM-only packages, so they must be transformed
// for Jest's CJS runtime. This list matches @grafana/create-plugin.
const esModules = [
  'd3',
  'd3-.*', // the d3 metapackage re-exports ~30 ESM-only d3-* subpackages
  'delaunator',
  'internmap',
  'robust-predicates',
  // TESTING (2026-07): additional ESM-only packages pulled in transitively by
  // @grafana/ui, needed once unit tests render the panel component.
  '@grafana/schema',
  'ol',
  'react-colorful',
  'uuid',
  'nanoid',
].join('|');

module.exports = {
  testEnvironment: 'jest-environment-jsdom',
  testMatch: ['<rootDir>/src/**/*.{spec,test}.{js,jsx,ts,tsx}'],
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest',
      {
        sourceMaps: 'inline',
        jsc: {
          parser: { syntax: 'typescript', tsx: true },
          transform: { react: { runtime: 'classic' } },
        },
      },
    ],
  },
  transformIgnorePatterns: [`node_modules/(?!(${esModules})/)`],
  moduleDirectories: ['node_modules', 'src'],
  moduleNameMapper: {
    // TESTING (2026-07): stub out stylesheet and image imports (jsdom cannot
    // parse them; @grafana/ui transitively imports CSS).
    '\\.(css|scss|sass|less)$': '<rootDir>/jest-mocks/style.js',
    '\\.(png|jpe?g|gif|svg)$': '<rootDir>/jest-mocks/style.js',
  },
  // TESTING (2026-07): registers @testing-library/jest-dom matchers and
  // polyfills jsdom gaps (SVG text measurement, matchMedia).
  setupFilesAfterEnv: ['<rootDir>/jest-setup.js'],
};
