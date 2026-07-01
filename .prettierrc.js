// REFACTOR (2026-07): Inlined the prettier settings that used to be pulled
// from the deprecated @grafana/toolkit package (these values match the
// toolkit's prettier.plugin.config.json / the create-plugin scaffold).
module.exports = {
  endOfLine: 'auto',
  printWidth: 120,
  trailingComma: 'es5',
  semi: true,
  jsxSingleQuote: false,
  singleQuote: true,
  useTabs: false,
  tabWidth: 2,
};
