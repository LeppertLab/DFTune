// Bundles the extension host code (Node, CommonJS) and the webview UI (browser, IIFE).
// Everything is bundled locally: the webview never loads anything from the network,
// because HPC login nodes are often offline.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

const builds = [
  {
    ...common,
    entryPoints: ['src/extension/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: ['src/webview/main.tsx'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
  },
  {
    // The structure viewer is its own bundle, so the builders don't load three.js.
    ...common,
    entryPoints: ['src/viewer/main.tsx'],
    outfile: 'dist/viewer.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
  },
];

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
