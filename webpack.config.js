// REFACTOR (2026-07): This webpack config replaces the deprecated
// @grafana/toolkit build pipeline (`grafana-toolkit plugin:build`).
// Grafana deprecated the toolkit in 2022; the officially supported approach
// is a webpack 5 build like the one scaffolded by @grafana/create-plugin.
// This config is modeled on that scaffold:
//  - Compiles TS/TSX with SWC (fast, no babel chain).
//  - Emits an AMD module (`dist/module.js`), which is how Grafana loads
//    panel plugins at runtime.
//  - Marks react/@grafana packages as externals - Grafana provides these
//    at runtime, so they must NOT be bundled.
//  - Copies plugin.json, images, README, CHANGELOG, and LICENSE into dist/
//    and substitutes the %VERSION% / %TODAY% placeholders that the toolkit
//    used to handle.
//  - d3 (now a real npm dependency instead of a vendored src/d3.min.js)
//    IS bundled, since Grafana does not provide it.

const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const { DefinePlugin } = require('webpack');
const packageJson = require('./package.json');

const SOURCE_DIR = path.resolve(__dirname, 'src');
const DIST_DIR = path.resolve(__dirname, 'dist');

module.exports = (env) => {
  const production = !!env.production;

  return {
    mode: production ? 'production' : 'development',
    target: ['web', 'es2018'],
    context: SOURCE_DIR,
    entry: { module: './module.ts' },
    devtool: production ? 'source-map' : 'eval-source-map',

    output: {
      clean: true,
      path: DIST_DIR,
      filename: '[name].js',
      // Grafana's plugin loader consumes AMD modules.
      libraryTarget: 'amd',
      publicPath: '/',
    },

    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
      // Preserve the old toolkit behavior of resolving imports relative
      // to src/ (e.g. `import {ChordOptions} from 'types'`).
      modules: [SOURCE_DIR, 'node_modules'],
    },

    // Provided by the Grafana runtime - never bundle these.
    externals: [
      'react',
      'react-dom',
      '@grafana/data',
      '@grafana/runtime',
      '@grafana/ui',
      '@emotion/css',
      '@emotion/react',
      'rxjs',
      'lodash',
      'moment',
    ],

    module: {
      rules: [
        {
          test: /\.[tj]sx?$/,
          exclude: /node_modules/,
          use: {
            loader: 'swc-loader',
            options: {
              jsc: {
                target: 'es2018',
                loose: false,
                parser: {
                  syntax: 'typescript',
                  tsx: true,
                  decorators: false,
                  dynamicImport: true,
                },
              },
            },
          },
        },
        {
          test: /\.(png|jpe?g|gif|svg)$/,
          type: 'asset/resource',
          generator: { filename: 'img/[name][ext]' },
        },
      ],
    },

    plugins: [
      new DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: 'plugin.json',
            to: '.',
            // The toolkit used to substitute these placeholders; do the
            // same here so dist/plugin.json carries real metadata.
            transform(content) {
              return content
                .toString()
                .replace(/%VERSION%/g, packageJson.version)
                .replace(/%TODAY%/g, new Date().toISOString().substring(0, 10));
            },
          },
          { from: 'img/**/*', to: '.', noErrorOnMissing: true },
          { from: '../README.md', to: '.', noErrorOnMissing: true },
          { from: '../CHANGELOG.md', to: '.', noErrorOnMissing: true },
          { from: '../LICENSE', to: '.', noErrorOnMissing: true },
        ],
      }),
      // Type-check in parallel with the SWC transpile (SWC itself does not
      // check types).
      new ForkTsCheckerWebpackPlugin({
        typescript: { configFile: path.resolve(__dirname, 'tsconfig.json') },
      }),
    ],
  };
};
